import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const headers = ["名次", "股票名稱", "買進", "賣出", "淨買賣張數", "淨買賣金額", "收盤價", "漲跌"];
const keys = ["rank", "stock_name", "buy_volume", "sell_volume", "net_volume", "net_amount", "close", "change"];

const form = document.querySelector("#toolForm");
const statusBox = document.querySelector("#status");
const button = document.querySelector("#convertButton");
const resultPanel = document.querySelector("#resultPanel");
const resultSummary = document.querySelector("#resultSummary");
const downloadLinks = document.querySelector("#downloadLinks");

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", isError);
}

function parseNumber(text) {
  const cleaned = String(text).replace(/,/g, "");
  return cleaned.includes(".") ? Number.parseFloat(cleaned) : Number.parseInt(cleaned, 10);
}

function validInt(text, signed = true) {
  const sign = signed ? "-?" : "";
  return new RegExp(`^${sign}(?:\\d{1,3}(?:,\\d{3})+|\\d+)$`).test(text);
}

function validDecimal(text, signed = true) {
  const sign = signed ? "-?" : "";
  return new RegExp(`^${sign}(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{2}$`).test(text);
}

function prefixes(text, validator, signed = true) {
  const out = [];
  for (let i = 1; i <= text.length; i += 1) {
    const part = text.slice(0, i);
    if (validator(part, signed)) out.push([part, text.slice(i)]);
  }
  return out;
}

function decimalPrefixValue(text, signed = true) {
  const matches = prefixes(text, validDecimal, signed);
  if (!matches.length) return null;
  return parseNumber(matches[matches.length - 1][0]);
}

function parseAmountCloseChange(text) {
  for (const [amountText, restAfterAmount] of prefixes(text, validInt, true)) {
    for (const [closeText, restAfterClose] of prefixes(restAfterAmount, validDecimal, false)) {
      const change = decimalPrefixValue(restAfterClose, true);
      if (change !== null) return [parseNumber(amountText), parseNumber(closeText), change];
    }
  }
  return null;
}

function parseNetAmountCloseChange(text) {
  for (const [netText, restAfterNet] of prefixes(text, validInt, true)) {
    for (const [amountText, restAfterAmount] of prefixes(restAfterNet, validInt, true)) {
      for (const [closeText, restAfterClose] of prefixes(restAfterAmount, validDecimal, false)) {
        const change = decimalPrefixValue(restAfterClose, true);
        if (change !== null) return [parseNumber(netText), parseNumber(amountText), parseNumber(closeText), change];
      }
    }
  }
  return null;
}

function parseTail(text, buy, sell) {
  const expectedNet = buy - sell;
  const expectedText = expectedNet.toLocaleString("en-US");
  if (!text.startsWith(expectedText)) return null;
  const rest = text.slice(expectedText.length);
  const parsed = parseAmountCloseChange(rest);
  return parsed ? [expectedNet, ...parsed] : null;
}

function parseCompactNumbers(text) {
  for (const [buyText, rest1] of prefixes(text, validInt, false)) {
    const buy = parseNumber(buyText);
    for (const [sellText, rest2] of prefixes(rest1, validInt, false)) {
      const sell = parseNumber(sellText);
      const tail = parseTail(rest2, buy, sell);
      if (tail) return [buy, sell, ...tail];
    }
  }
  return null;
}

function parseSide(words) {
  if (words.length < 3 || !/^\d+$/.test(words[0].str)) return null;
  const rank = Number.parseInt(words[0].str, 10);
  if (words[1] && validInt(words[1].str, false)) {
    throw new Error(`第 ${rank} 名缺少股票名稱，請重新整理後再試一次；若仍失敗，代表此 PDF 版面需要新增解析規則。`);
  }
  let numericStart = 1;
  while (
    numericStart < words.length &&
    !(validInt(words[numericStart].str, false) && validInt(words[numericStart + 1]?.str || "", false))
  ) {
    numericStart += 1;
  }
  if (numericStart <= 1 || numericStart >= words.length) {
    throw new Error(`無法解析第 ${rank} 名股票名稱：${words.map((w) => w.str).join(" ")}`);
  }
  const stockName = words
    .slice(1, numericStart)
    .map((word) => word.str)
    .join("")
    .replace(/\s+/g, "");
  const rawRest = words.slice(numericStart).map((word) => word.str);
  const rest = [];
  for (let i = 0; i < rawRest.length; i += 1) {
    if (rawRest[i] === "-" && rawRest[i + 1]) {
      rest.push(`-${rawRest[i + 1]}`);
      i += 1;
    } else {
      rest.push(rawRest[i]);
    }
  }
  let numbers = null;

  if (
    rest.length >= 6 &&
    validInt(rest[0], false) &&
    validInt(rest[1], false) &&
    validInt(rest[2], true) &&
    validInt(rest[3], true) &&
    validDecimal(rest[4], false) &&
    (validDecimal(rest[5], true) || decimalPrefixValue(rest[5], true) !== null)
  ) {
    numbers = [
      parseNumber(rest[0]),
      parseNumber(rest[1]),
      parseNumber(rest[2]),
      parseNumber(rest[3]),
      parseNumber(rest[4]),
      validDecimal(rest[5], true) ? parseNumber(rest[5]) : decimalPrefixValue(rest[5], true)
    ];
  }

  if (!numbers && rest.length >= 4 && validInt(rest[0], false) && validInt(rest[1], false) && validInt(rest[2], true)) {
    const parsed = parseAmountCloseChange(rest.slice(3).join(""));
    if (parsed) numbers = [parseNumber(rest[0]), parseNumber(rest[1]), parseNumber(rest[2]), ...parsed];
  }

  if (!numbers && rest.length >= 4 && validInt(rest[0], false) && validInt(rest[1], false)) {
    const parsed = parseNetAmountCloseChange(rest[2]);
    const change = decimalPrefixValue(rest[3], true);
    if (parsed && change !== null) numbers = [parseNumber(rest[0]), parseNumber(rest[1]), ...parsed, change];
  }

  if (!numbers && rest.length >= 3 && validInt(rest[0], false) && validInt(rest[1], false)) {
    const parsed = parseNetAmountCloseChange(rest.slice(2).join(""));
    if (parsed) numbers = [parseNumber(rest[0]), parseNumber(rest[1]), ...parsed];
  }

  if (!numbers && rest.length >= 3 && validInt(rest[0], false) && validInt(rest[1], false)) {
    const buy = parseNumber(rest[0]);
    const sell = parseNumber(rest[1]);
    const parsed = parseTail(rest.slice(2).join(""), buy, sell);
    if (parsed) numbers = [buy, sell, ...parsed];
  }

  if (!numbers) numbers = parseCompactNumbers(rest.join(""));
  if (!numbers) throw new Error(`無法解析第 ${rank} 名資料：${words.map((w) => w.str).join(" ")}`);

  return {
    rank,
    stock_name: stockName,
    buy_volume: numbers[0],
    sell_volume: numbers[1],
    net_volume: numbers[2],
    net_amount: numbers[3],
    close: numbers[4],
    change: numbers[5]
  };
}

async function extractPdfRows(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const buy = [];
  const sell = [];
  let title = "";
  let period = "";
  let context = "";

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const words = content.items
      .map((item) => ({
        str: item.str.trim(),
        x: item.transform[4],
        y: item.transform[5]
      }))
      .filter((item) => item.str);

    const lines = [];
    for (const word of [...words].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const existing = lines.find((line) => Math.abs(line[0].y - word.y) <= 4);
      if (existing) {
        existing.push(word);
      } else {
        lines.push([word]);
      }
    }
    for (const line of lines) line.sort((a, b) => a.x - b.x);
    for (const line of lines) {
      const lineText = line.map((word) => word.str).join(" ");
      if (lineText.includes("買賣超金額排行") && !lineText.includes("Page")) title = lineText.trim();
      const match = lineText.match(/從\s*(\d{4}\/\d{2}\/\d{2})\s*到\s*(\d{4}\/\d{2}\/\d{2})/);
      if (match) period = `${match[1]} 到 ${match[2]}`;
      if (lineText.includes("單位：千元")) context = lineText.replace(/\s+/g, " ").trim();
      if (!/^\d+$/.test(line[0]?.str || "")) continue;

      let left = line.filter((word) => word.x < 400);
      let right = line.filter((word) => word.x >= 400);
      if (left.length >= 7 && right.length && /^-?\d+\.\d{2}$/.test(right[0].str)) {
        left = [...left, right[0]];
        right = right.slice(1);
      }
      if (left.length) {
        const row = parseSide(left);
        if (row) buy.push(row);
      }
      if (right.length) {
        if (!/^\d+$/.test(right[0].str) && left[0]?.str) right = [{ str: left[0].str, x: 406, y: right[0].y }, ...right];
        const row = parseSide(right);
        if (row) sell.push(row);
      }
    }
  }

  return {
    title: title || "買賣超金額排行",
    period,
    context,
    buy: buy.sort((a, b) => a.rank - b.rank),
    sell: sell.sort((a, b) => a.rank - b.rank)
  };
}

function cleanFilename(value) {
  return String(value || "")
    .replace(/[\/\\<>:"|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function rowsToSheetRows(rows) {
  return [headers, ...rows.map((row) => keys.map((key) => row[key]))];
}

function makeSideBySideWorkbook(data) {
  const wb = XLSX.utils.book_new();
  const summary = [
    ["資料名稱", data.title],
    [],
    ["資料期間", data.period],
    ["單位", "千元"],
    ["買超筆數", data.buy.length],
    ["賣超筆數", data.sell.length]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "摘要");

  const rows = [];
  rows.push(["買超", "", "", "", "", "", "", "", "", "賣超"]);
  rows.push([data.context, "", "", "", "", "", "", "", "", data.context]);
  rows.push([]);
  const maxRows = Math.max(data.buy.length, data.sell.length);
  rows.push([...headers, "", ...headers]);
  for (let i = 0; i < maxRows; i += 1) {
    const left = data.buy[i] ? keys.map((key) => data.buy[i][key]) : Array(8).fill("");
    const right = data.sell[i] ? keys.map((key) => data.sell[i][key]) : Array(8).fill("");
    rows.push([...left, "", ...right]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  styleRange(ws, rows.length, rows[3].length, new Map());
  ws["!cols"] = [{ wch: 8 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 3 }, { wch: 8 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws, "買賣超合併");
  return wb;
}

function stockSet(rows) {
  return new Set(rows.map((row) => row.stock_name).filter(Boolean));
}

function inSet(set, value) {
  return set.has(value);
}

function makeMergedWorkbook(foreignData, institutionData) {
  const wb = XLSX.utils.book_new();
  const foreignBuy = stockSet(foreignData.buy);
  const foreignSell = stockSet(foreignData.sell);
  const institutionBuy = stockSet(institutionData.buy);
  const institutionSell = stockSet(institutionData.sell);
  const sameBuy = new Set([...foreignBuy].filter((name) => institutionBuy.has(name)));
  const sameSell = new Set([...foreignSell].filter((name) => institutionSell.has(name)));
  const opposite = new Set([
    ...[...foreignBuy].filter((name) => institutionSell.has(name)),
    ...[...institutionBuy].filter((name) => foreignSell.has(name))
  ]);
  const blocks = [
    ["外資買超", foreignData.buy, sameBuy],
    ["投信買超", institutionData.buy, sameBuy],
    ["外資賣超", foreignData.sell, sameSell],
    ["投信賣超", institutionData.sell, sameSell]
  ];
  const rows = [];
  const colorByCell = new Map();
  rows.push(blocks.flatMap(([title]) => [title, "", "", "", "", "", "", "", ""]).slice(0, 35));
  rows.push([]);
  rows.push(blocks.flatMap(() => [...headers, ""]).slice(0, 35));
  for (let i = 0; i < Math.max(...blocks.map(([, list]) => list.length)); i += 1) {
    const rowIndex = rows.length;
    rows.push(blocks.flatMap(([title, list, sameSet], blockIndex) => {
      const row = list[i] ? keys.map((key) => list[i][key]) : Array(8).fill("");
      if (list[i]) {
        const color = inSet(sameSet, list[i].stock_name) ? "C00000" : inSet(opposite, list[i].stock_name) ? "008000" : null;
        if (color) {
          const startCol = blockIndex * 9;
          for (let offset = 0; offset < 8; offset += 1) {
            colorByCell.set(`${rowIndex}:${startCol + offset}`, color);
          }
        }
      }
      return [...row, ""];
    }).slice(0, 35));
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  styleRange(ws, rows.length, 35, colorByCell);
  XLSX.utils.book_append_sheet(wb, ws, "外資投信買賣超");
  return { wb, sameBuyCount: sameBuy.size, sameSellCount: sameSell.size, oppositeCount: opposite.size };
}

function styleRange(ws, rowCount, colCount, colorByCell) {
  for (let r = 0; r < rowCount; r += 1) {
    for (let c = 0; c < colCount; c += 1) {
      const address = XLSX.utils.encode_cell({ r, c });
      if (!ws[address]) continue;
      const color = colorByCell.get(`${r}:${c}`);
      ws[address].s = {
        font: { name: "Arial", sz: 10, color: color ? { rgb: color } : undefined, bold: r === 0 || r === 3 || r === 2 },
        fill: r === 2 || r === 3 ? { fgColor: { rgb: "D9EAF7" } } : undefined,
        alignment: { vertical: "center" },
        border: {
          bottom: { style: "thin", color: { rgb: "E5E7EB" } }
        }
      };
    }
  }
}

function downloadWorkbook(workbook, filename) {
  XLSX.writeFile(workbook, filename, { compression: true });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const foreignFile = document.querySelector("#foreignPdf").files[0];
  const institutionFile = document.querySelector("#institutionPdf").files[0];
  button.disabled = true;
  resultPanel.hidden = true;
  downloadLinks.innerHTML = "";
  setStatus("正在讀取 PDF 並產生 Excel。");
  try {
    const [foreignData, institutionData] = await Promise.all([extractPdfRows(foreignFile), extractPdfRows(institutionFile)]);
    const foreignName = `${cleanFilename(foreignData.title)}_${cleanFilename(foreignData.period)}.xlsx`;
    const institutionName = `${cleanFilename(institutionData.title)}_${cleanFilename(institutionData.period)}.xlsx`;
    const mergedName = `外資投信買賣超_${cleanFilename(foreignData.period || institutionData.period)}.xlsx`;
    const merged = makeMergedWorkbook(foreignData, institutionData);
    const files = [
      ["外資 Excel", makeSideBySideWorkbook(foreignData), foreignName],
      ["投信 Excel", makeSideBySideWorkbook(institutionData), institutionName],
      ["合併比較 Excel", merged.wb, mergedName]
    ];
    for (const [label, workbook, filename] of files) {
      const buttonLink = document.createElement("button");
      buttonLink.type = "button";
      buttonLink.className = "download";
      buttonLink.textContent = label;
      buttonLink.addEventListener("click", () => downloadWorkbook(workbook, filename));
      downloadLinks.appendChild(buttonLink);
    }
    resultSummary.textContent = `外資買超 ${foreignData.buy.length} 筆、外資賣超 ${foreignData.sell.length} 筆；投信買超 ${institutionData.buy.length} 筆、投信賣超 ${institutionData.sell.length} 筆。`;
    resultPanel.hidden = false;
    setStatus("完成。請選擇要下載的 Excel 檔。");
  } catch (error) {
    setStatus(error.message || "轉換失敗。", true);
  } finally {
    button.disabled = false;
  }
});

