/** Preserve UTF-8 across transport boundaries; flush lines and bound long lines. */
export class StreamInputError extends Error {}

export async function* frameText(source: AsyncIterable<Uint8Array>, maxChars = 2048) {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let pending = "";
  let bytes = 0;
  function* drain(final: boolean) {
    while (pending.length) {
      const newline = pending.indexOf("\n");
      let length = newline >= 0 && newline < maxChars ? newline + 1 : Math.min(pending.length, maxChars);
      if (!final && newline < 0 && pending.length < maxChars) break;
      // Do not split a UTF-16 surrogate pair when bounding a long line.
      if (length < pending.length && /[\uD800-\uDBFF]/.test(pending[length - 1])) length--;
      const text = pending.slice(0, length);
      pending = pending.slice(length);
      yield text;
    }
  }
  for await (const buffer of source) {
    bytes += buffer.byteLength;
    if (bytes > 1024 * 1024) throw new StreamInputError("Upload exceeds 1 MiB; append with a new request");
    pending += decoder.decode(buffer, { stream: true });
    yield* drain(false);
  }
  pending += decoder.decode();
  yield* drain(true);
}
