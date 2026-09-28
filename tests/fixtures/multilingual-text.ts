export const multilingualText = [
  "Cloud cloud 雲端 雲端 データ data",
  "ภาษาไทย 中文 English",
  "人工智慧與 Cloudflare Workers 一起讓資料在瀏覽器本機長成圖像。",
].join(" ");

export const privateSourceText =
  "private source never leaves this browser; creator notes stay local";

export function uniqueLatinWords(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `word${letters(index)}`);
}

function letters(value: number): string {
  let remainder = value;
  let result = "";
  do {
    result = String.fromCodePoint(97 + (remainder % 26)) + result;
    remainder = Math.floor(remainder / 26) - 1;
  } while (remainder >= 0);
  return result;
}
