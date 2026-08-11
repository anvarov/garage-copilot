export function chunkText(text: string, size = 700, overlap = 100): string[] {
    if (overlap >= size) {
        throw new Error("overlap should be less than size")
    }
    const res: string[] = []
    for (let start = 0; start < text.length; start += size - overlap) {
        if (start > 0 && text.length - start <= overlap) break;
        res.push(text.slice(start, start + size))
    }
    
    return res
}
