// The protocol's lines: split on "\n" alone. readline also ends a line at
// U+2028 and U+2029, which JSON carries unescaped inside a string.
import { StringDecoder } from "node:string_decoder";

/** Call `onLine` with each line `stream` delivers, without its "\n". */
export function lines(stream, onLine) {
  const decoder = new StringDecoder("utf8");
  let buf = "";
  stream.on("data", (chunk) => {
    buf += decoder.write(chunk);
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      onLine(line);
    }
  });
  stream.on("end", () => {
    buf += decoder.end();
    if (buf) onLine(buf);
  });
}
