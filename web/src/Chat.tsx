import { useState } from "react";
import { streamChat } from "./api";

type Message = { role: "user" | "assistant"; text: string };

export function Chat() {
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<Message[]>([]);
    const [streaming, setStreaming] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function send() {
        const question = input.trim();
        if (!question || isStreaming) return;

        setMessages((prev) => [...prev, { role: "user", text: question }]);
        setInput("");
        setError(null);
        setStreaming("");
        setIsStreaming(true);

        // Accumulated locally as well as in state: when the stream ends we
        // need the full text to move into `messages`, and reading it out of
        // `streaming` there would give us the value from the render that
        // created this closure, not the latest one.
        let full = "";

        try {
            await streamChat(question, {
                onText: (text) => {
                    full += text;
                    // Function form. `setStreaming(streaming + text)` would
                    // capture a stale `streaming` — chunks arrive faster than
                    // React re-renders, so several in a row would all read the
                    // same old value and overwrite each other.
                    setStreaming((prev) => prev + text);
                },
                onSources: () => {
                    // Sources panel is tomorrow.
                },
            });

            setMessages((prev) => [...prev, { role: "assistant", text: full }]);
        } catch (err) {
            setError(err instanceof Error ? err.message : "something went wrong");
        } finally {
            // Must run on BOTH paths, or a failed request leaves the input
            // disabled forever.
            setStreaming("");
            setIsStreaming(false);
        }
    }

    function handleSubmit(e: React.SubmitEvent) {
        e.preventDefault(); // otherwise the browser reloads the page
        void send();
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
        }
    }

    return (
        <div>
            <h1>Garage Copilot</h1>

            <div>
                {messages.map((m, i) => (
                    <p key={i} style={{ whiteSpace: "pre-wrap" }}>
                        <strong>{m.role === "user" ? "You" : "Assistant"}</strong>
                        <br />
                        {m.text}
                    </p>
                ))}

                {streaming && (
                    <p style={{ whiteSpace: "pre-wrap" }}>
                        <strong>Assistant</strong>
                        <br />
                        {streaming}
                    </p>
                )}

                {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
            </div>

            <form onSubmit={handleSubmit}>
                <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={3}
                    placeholder="Ask about a repair..."
                    disabled={isStreaming}
                />
                <br />
                <button type="submit" disabled={isStreaming || !input.trim()}>
                    {isStreaming ? "Thinking..." : "Ask"}
                </button>
            </form>
        </div>
    );
}
