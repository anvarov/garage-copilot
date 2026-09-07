export type Source = {
    n: number;
    title: string;
    author: string | null;
    url: string | null;
    ordinal: number;
};

type Handlers = {
    onText: (text: string) => void;
    onSources: (sources: Source[]) => void;
};

export async function streamChat(
    message: string,
    handlers: Handlers
): Promise<void> {
    const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
    });

    // fetch does NOT reject on 4xx/5xx — it resolves with ok === false.
    // Without this, a 500 from the server gets fed to the SSE parser as if
    // it were a stream.
    if (!res.ok) {
        throw new Error(`chat failed: ${res.status} ${res.statusText}`);
    }
    if (!res.body) {
        throw new Error("chat response has no body");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // { stream: true } tells the decoder a multi-byte character may be
        // split across chunk boundaries — hold the partial bytes rather than
        // emitting a replacement character.
        buffer += decoder.decode(value, { stream: true });

        // Network chunks have nothing to do with frame boundaries. Split off
        // the complete frames and push the trailing partial back into the
        // buffer to wait for the next read.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
            if (!frame.trim()) continue;

            // A frame with no `event:` line is a plain message — that's the
            // SSE default, and it's what carries the streamed text.
            let eventName = "message";
            let data = "";

            for (const line of frame.split("\n")) {
                if (line.startsWith("event:")) {
                    eventName = line.slice("event:".length).trim();
                } else if (line.startsWith("data:")) {
                    // slice by prefix LENGTH, not replace() — replace would
                    // also strip the text "data:" if it appeared inside the
                    // payload. SSE allows several data: lines per frame, so
                    // append rather than assign.
                    data += line.slice("data:".length).trim();
                }
            }

            if (!data) continue;

            switch (eventName) {
                case "sources":
                    handlers.onSources(JSON.parse(data) as Source[]);
                    break;

                case "message":
                    handlers.onText((JSON.parse(data) as { text: string }).text);
                    break;

                case "error":
                    throw new Error((JSON.parse(data) as { error: string }).error);

                case "done":
                    return;
            }
        }
    }
}
