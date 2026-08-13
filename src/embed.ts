import OpenAI from "openai";

export const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export async function embed(chunks: string[]): Promise<number[][]> {
    if (chunks.length === 0) {
        throw new Error("chunks should not be empty");
    };
    const createEmbeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: chunks
    });
    const { data } = createEmbeddingResponse;

    return data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}
