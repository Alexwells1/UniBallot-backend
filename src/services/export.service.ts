import { stringify } from "csv-stringify/sync";
import PDFDocument from "pdfkit";
import type { IElection } from "../models/Election";
import type { OfficeTally } from "./results.service";

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

const DS = {
  page: {
    width: 595.28,
    height: 841.89,
    mH: 48,
    mT: 44, 
    mB: 44, 
  },

  sp: {
    s4: 4,
    s6: 6,
    s8: 8,
    s10: 10,
    s12: 12,
    s16: 16,
    s20: 20,
    s24: 24,
    s32: 32,
    s40: 40,
  },

  type: {
    instName: 16,       // institution name  ↑ was 13
    subBody: 12,        // sub-body          ↑ was 10
    reportTitle: 14,    // "E-Voting Report" ↑ was 12
    elecName: 14,       // election title    ↑ was 11
    metaText: 11,       // metadata line     ↑ was 9
    summaryHdr: 12,     // "ELECTION SUMMARY"↑ was 10
    summaryVal: 11,     // summary values    ↑ was 10
    posTitle: 14,       // PRESIDENT, VP…    ↑ was 11
    winnerLabel: 11,    // "Winner:" label   ↑ was 9
    winnerName: 12,     // winner name       ↑ was 10
    tableHdr: 11,       // table header row  ↑ was 9
    tableBody: 11,      // table data rows   ↑ was 9
    tableFooter: 11,    // total votes row   ↑ was 9
  },

  color: {
    black: "#000000",
    dark: "#1a1a1a",
    body: "#222222",
    muted: "#333333",   // was #777777 — dark enough to read boldly
    subtle: "#555555",  // was #aaaaaa
    border: "#bbbbbb",
    rule: "#cccccc",
  },

  // Table columns — must sum to TBL_W
  // TBL_W = page.width - mH*2 = 595.28 - 96 = 499.28 → 499
  col: {
    serno: 36,
    name: 363,
    votes: 100,
  },

  row: {
    hdr: 24,    // ↑ was 20 — fits larger header text
    body: 22,   // ↑ was 18 — fits larger body text
    footer: 22, // ↑ was 18
  },
} as const;

const PG = DS.page;
const SP = DS.sp;
const COL = DS.col;
const ROW = DS.row;
const X = PG.mH;
const CW = PG.width - PG.mH * 2;
const TBL_W = COL.serno + COL.name + COL.votes;

const X_NAME = X + COL.serno;
const X_VOTES = X_NAME + COL.name;

// ─────────────────────────────────────────────────────────────────────────────
// DATA TYPES  &  BUSINESS LOGIC
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessedOffice {
  positionTitle: string;
  voteType: 'competitive' | 'confirmation';
  candidates: Array<{ fullName: string; voteCount: number }>;
  totalVotes: number;
  candidateCount: number;
  winnerText: string;
  winnerStatus: "single" | "tie" | "none";
}

export function processOffice(office: OfficeTally): ProcessedOffice {
  const positionTitle = office.officeTitle.toUpperCase();
  const raw = office.candidates ?? [];
  const candidates = [...raw].sort((a, b) => b.voteCount - a.voteCount);
  const totalVotes = candidates.reduce((s, c) => s + c.voteCount, 0);
  const candidateCount = candidates.length;

  // ── Confirmation ballot (single candidate, approve/reject vote) ─────────────
  if (office.voteType === 'confirmation') {
    const candidateName = candidates[0]?.fullName?.toUpperCase() ?? 'CANDIDATE';
    const approveCount  = office.approveCount ?? 0;
    const rejectCount   = office.rejectCount  ?? 0;
    const confirmTotal  = approveCount + rejectCount;

    if (confirmTotal === 0) {
      return {
        positionTitle,
        voteType: 'confirmation',
        candidates,
        totalVotes: confirmTotal,
        candidateCount,
        winnerText: 'No valid votes recorded',
        winnerStatus: 'none',
      };
    }

    // Tie — equal approve/reject
    if (office.isTie || approveCount === rejectCount) {
      return {
        positionTitle,
        voteType: 'confirmation',
        candidates,
        totalVotes: confirmTotal,
        candidateCount,
        winnerText: `TIE — ${candidateName} received equal approve and reject votes (${approveCount} each)`,
        winnerStatus: 'tie',
      };
    }

    // elected=true → approved; elected=false → rejected (more reject votes than approve)
    const isElected = office.elected === true || approveCount > rejectCount;
    const winnerText = isElected
      ? `${candidateName} — ELECTED (${fmtVotes(approveCount)} approve vs ${fmtVotes(rejectCount)} reject)`
      : `${candidateName} — NOT ELECTED (${fmtVotes(rejectCount)} reject vs ${fmtVotes(approveCount)} approve)`;

    return {
      positionTitle,
      voteType: 'confirmation',
      candidates,
      totalVotes: confirmTotal,
      candidateCount,
      winnerText,
      winnerStatus: isElected ? 'single' : 'none',
    };
  }

  // ── Competitive ballot (multiple candidates, pick highest vote-getter) ───────
  if (candidateCount === 0 || totalVotes === 0) {
    return {
      positionTitle,
      candidates,
      totalVotes,
      candidateCount,
      winnerText: 'No valid votes recorded',
      winnerStatus: 'none',
      voteType: 'competitive',
    };
  }

  const maxVotes = candidates[0].voteCount;
  const topTied  = candidates.filter((c) => c.voteCount === maxVotes);
  const voteLabel = fmtVotes(maxVotes);

  if (topTied.length === 1) {
    return {
      positionTitle,
      candidates,
      totalVotes,
      candidateCount,
      winnerText: `${topTied[0].fullName.toUpperCase()} — ${voteLabel}`,
      winnerStatus: 'single',
      voteType: 'competitive',
    };
  }

  const names = topTied.map((c) => c.fullName.toUpperCase()).join(' & ');
  return {
    positionTitle,
    voteType: 'competitive',
    candidates,
    totalVotes,
    candidateCount,
    winnerText: `TIE — ${names}, ${voteLabel} each`,
    winnerStatus: 'tie',
  };
}

function fmtVotes(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "vote" : "votes"}`;
}

export interface ElectionSummary {
  registeredVoters: number;
  totalVotesCast: number;
  turnoutPct: string;
  status: string;
  electionDate: string;
}

export function computeSummary(
  election: IElection,
  tally: OfficeTally[],
  registeredVoters = 0,
): ElectionSummary {
  const maxOfficeVotes =
    tally.length > 0 ? Math.max(...tally.map((o) => o.totalVotes)) : 0;

  const totalVotesCast = maxOfficeVotes;
  const turnoutPct =
    registeredVoters > 0
      ? `${((totalVotesCast / registeredVoters) * 100).toFixed(1)}%`
      : "N/A";

  const electionDate = election.updatedAt
    ? new Date(election.updatedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "N/A";

  return {
    registeredVoters,
    totalVotesCast,
    turnoutPct,
    status: election.status
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase()),
    electionDate,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export function generateCsv(election: IElection, tally: OfficeTally[]): string {
  const rows: (string | number)[][] = [
    ["Election Title", election.title],
    ["Election Code", election.electionCode],
    ["Status", election.status],
    ["Published At", election.updatedAt.toISOString()],
    ["Exported At", new Date().toISOString()],
    [],
    ["Office", "Type", "Candidates", "Total Votes", "Winner / Outcome"],
  ];

  for (const office of tally) {
    const p = processOffice(office);
    rows.push([
      office.officeTitle,
      office.voteType,
      p.candidateCount,
      p.totalVotes,
      p.winnerText,
    ]);
    for (const c of p.candidates)
      rows.push(["", "", `  ${c.fullName}`, c.voteCount, ""]);
    rows.push([]);
  }

  return stringify(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

type Doc = InstanceType<typeof PDFDocument>;

function hLine(
  doc: Doc,
  x1: number,
  x2: number,
  y: number,
  color: string,
  lw = 0.5,
): void {
  doc
    .save()
    .moveTo(x1, y)
    .lineTo(x2, y)
    .strokeColor(color)
    .lineWidth(lw)
    .stroke()
    .restore();
}

function vLine(
  doc: Doc,
  x: number,
  y1: number,
  y2: number,
  color: string,
  lw = 0.5,
): void {
  doc
    .save()
    .moveTo(x, y1)
    .lineTo(x, y2)
    .strokeColor(color)
    .lineWidth(lw)
    .stroke()
    .restore();
}

function fillRect(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  doc.save().rect(x, y, w, h).fillColor(color).fill().restore();
}

function cell(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: {
    align?: "left" | "center" | "right";
    font?: string;
    size?: number;
    color?: string;
    padH?: number;
  } = {},
): void {
  const {
    align = "left",
    font = "Helvetica-Bold",        // ← default is now Bold everywhere
    size = DS.type.tableBody,
    color = DS.color.body,
    padH = 5,
  } = opts;

  doc
    .save()
    .font(font)
    .fontSize(size)
    .fillColor(color)
    .text(text, x + padH, y + (h - size) / 2, {
      width: w - padH * 2,
      align,
      lineBreak: false,
      ellipsis: true,
    })
    .restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL-GRID TABLE
// ─────────────────────────────────────────────────────────────────────────────

function renderTable(doc: Doc, p: ProcessedOffice): void {
  const { candidates, totalVotes } = p;
  const startY = doc.y;
  const rowCount = Math.max(candidates.length, 1);

  const lines = [
    startY,
    startY + ROW.hdr,
    ...Array.from(
      { length: rowCount },
      (_, i) => startY + ROW.hdr + ROW.body * (i + 1),
    ),
    startY + ROW.hdr + ROW.body * rowCount + ROW.footer,
  ];

  for (const ly of lines) {
    hLine(doc, X, X + TBL_W, ly, DS.color.border, 0.5);
  }

  const bodyBottom = startY + ROW.hdr + ROW.body * rowCount;
  [X, X_NAME, X_VOTES, X + TBL_W].forEach((lx) => {
    vLine(doc, lx, startY, bodyBottom, DS.color.border, 0.5);
  });
  vLine(doc, X, bodyBottom, bodyBottom + ROW.footer, DS.color.border, 0.5);
  vLine(doc, X + TBL_W, bodyBottom, bodyBottom + ROW.footer, DS.color.border, 0.5);

  // ── Header row — bold, dark ─────────────────────────────────────────────────
  cell(doc, "S/No", X, startY, COL.serno, ROW.hdr, {
    font: "Helvetica-Bold",
    size: DS.type.tableHdr,
    color: DS.color.dark,
  });
  cell(doc, "Candidate Name", X_NAME, startY, COL.name, ROW.hdr, {
    font: "Helvetica-Bold",
    size: DS.type.tableHdr,
    color: DS.color.dark,
  });
  cell(doc, "Total Votes", X_VOTES, startY, COL.votes, ROW.hdr, {
    font: "Helvetica-Bold",
    size: DS.type.tableHdr,
    color: DS.color.dark,
  });

  // ── Body rows — bold, dark ──────────────────────────────────────────────────
  if (candidates.length === 0) {
    const ry = startY + ROW.hdr;
    cell(doc, "—", X, ry, COL.serno, ROW.body, {
      align: "center",
      font: "Helvetica-Bold",
      color: DS.color.body,
    });
    cell(doc, "No candidates recorded", X_NAME, ry, COL.name + COL.votes, ROW.body, {
      font: "Helvetica-Bold",
      color: DS.color.body,
    });
  } else {
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const ry = startY + ROW.hdr + ROW.body * i;
      cell(doc, String(i + 1), X, ry, COL.serno, ROW.body, {
        font: "Helvetica-Bold",
        color: DS.color.body,
      });
      cell(doc, c.fullName, X_NAME, ry, COL.name, ROW.body, {
        font: "Helvetica-Bold",
        color: DS.color.body,
      });
      cell(doc, c.voteCount.toLocaleString("en-US"), X_VOTES, ry, COL.votes, ROW.body, {
        align: "right",
        font: "Helvetica-Bold",
        color: DS.color.body,
        padH: 8,
      });
    }
  }

  // ── Footer row ──────────────────────────────────────────────────────────────
  const fy = bodyBottom;
  fillRect(doc, X, fy, TBL_W, ROW.footer, "#f5f5f5");
  cell(doc, "Total Votes:", X, fy, COL.serno + COL.name, ROW.footer, {
    font: "Helvetica-Bold",
    size: DS.type.tableFooter,
    color: DS.color.dark,
  });
  cell(doc, totalVotes.toLocaleString("en-US"), X_VOTES, fy, COL.votes, ROW.footer, {
    align: "right",
    font: "Helvetica-Bold",
    size: DS.type.tableFooter,
    color: DS.color.dark,
    padH: 8,
  });

  doc.y = fy + ROW.footer;
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITION BLOCK
// ─────────────────────────────────────────────────────────────────────────────

function renderPositionBlock(doc: Doc, p: ProcessedOffice): void {
  // ── 1. Position title ───────────────────────────────────────────────────────
  doc
    .font("Helvetica-Bold")
    .fontSize(DS.type.posTitle)
    .fillColor(DS.color.dark)
    .text(p.positionTitle, X, doc.y, { width: CW, align: "center" });

  doc.y += SP.s8;

  // ── 2. Winner row — all bold, dark ─────────────────────────────────────────
  const winnerY = doc.y;

  const outcomeLabel = p.voteType === 'confirmation' ? 'Outcome:' : 'Winner:';
  doc
    .font("Helvetica-Bold")
    .fontSize(DS.type.winnerLabel)
    .fillColor(DS.color.dark)       // ← was muted, now dark
    .text(outcomeLabel, X, winnerY, { width: 60, lineBreak: false });

  doc
    .font("Helvetica-Bold")
    .fontSize(DS.type.winnerName)
    .fillColor(DS.color.dark)
    .text(p.winnerText, X + 64, winnerY, { width: CW - 64, lineBreak: false });

  doc.y = winnerY + DS.type.winnerName + SP.s4;

  // ── 3. Context line — bold, dark ────────────────────────────────────────────
  doc
    .font("Helvetica-Bold")
    .fontSize(DS.type.metaText)
    .fillColor(DS.color.dark)       // ← was muted
    .text(`Candidates: ${p.candidateCount}`, X, doc.y, { width: CW });

  doc.y += SP.s8;

  // ── 4. Table ─────────────────────────────────────────────────────────────────
  renderTable(doc, p);

  doc.y += SP.s32;
}

// ─────────────────────────────────────────────────────────────────────────────
// ELECTION SUMMARY BLOCK
// ─────────────────────────────────────────────────────────────────────────────

function renderSummaryBlock(doc: Doc, summary: ElectionSummary): void {
  doc
    .font("Helvetica-Bold")
    .fontSize(DS.type.summaryHdr)
    .fillColor(DS.color.dark)       // ← was muted
    .text("ELECTION SUMMARY", X, doc.y, { width: CW, characterSpacing: 0.5 });

  doc.y += SP.s8;

  const pairs: [string, string][] = [
    [
      "Registered Voters",
      summary.registeredVoters > 0
        ? summary.registeredVoters.toLocaleString("en-US")
        : "N/A",
    ],
    ["Total Votes Cast", summary.totalVotesCast.toLocaleString("en-US")],
    ["Voter Turnout", summary.turnoutPct],
    ["Status", summary.status],
    ["Date", summary.electionDate],
    [
      "Exported",
      new Date().toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    ],
  ];

  const colW = CW / 2;
  const lineH = DS.type.summaryVal + SP.s8;

  for (let i = 0; i < pairs.length; i += 2) {
    const rowY = doc.y;
    const left = pairs[i];
    const right = pairs[i + 1];

    // Left cell — label bold dark, value bold dark
    doc
      .font("Helvetica-Bold")
      .fontSize(DS.type.summaryVal)
      .fillColor(DS.color.dark)     // ← was muted
      .text(`${left[0]}:`, X, rowY, { width: 110, lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(DS.type.summaryVal)
      .fillColor(DS.color.dark)
      .text(left[1], X + 114, rowY, { width: colW - 114, lineBreak: false });

    // Right cell
    if (right) {
      doc
        .font("Helvetica-Bold")
        .fontSize(DS.type.summaryVal)
        .fillColor(DS.color.dark)   // ← was muted
        .text(`${right[0]}:`, X + colW, rowY, { width: 110, lineBreak: false });
      doc
        .font("Helvetica-Bold")
        .fontSize(DS.type.summaryVal)
        .fillColor(DS.color.dark)
        .text(right[1], X + colW + 114, rowY, {
          width: colW - 114,
          lineBreak: false,
        });
    }

    doc.y = rowY + lineH;
  }

  doc.y += SP.s16;

  hLine(doc, X, X + CW, doc.y, DS.color.rule, 0.5);
  doc.y += SP.s24;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF STREAM — public entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function streamPdf(
  election: IElection,
  tally: OfficeTally[],
  stream: NodeJS.WritableStream,
  meta?: {
    institutionName?: string;
    subBodyName?: string;
    registeredVoters?: number;
  },
): Promise<void> {
  const institutionName = meta?.institutionName ?? "Your Institution";
  const registeredVoters = meta?.registeredVoters ?? 0;

  const processed = tally.map(processOffice);
  const summary = computeSummary(election, tally, registeredVoters);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: PG.mH,
      bufferPages: false,
      info: {
        Title: election.title,
        Subject: "E-Voting Report",
      },
    });

    doc.on("error", reject);
    stream.on("error", reject);
    doc.pipe(stream);

    doc.y = PG.mT;

    // ── A. HEADER BLOCK ────────────────────────────────────────────────────────
    doc
      .font("Helvetica-Bold")
      .fontSize(DS.type.instName)
      .fillColor(DS.color.dark)
      .text(institutionName, X, doc.y, { align: "center", width: CW });

    doc.y += SP.s4;

    doc
      .font("Helvetica-Bold")
      .fontSize(DS.type.reportTitle)
      .fillColor(DS.color.dark)
      .text("E-Voting Report", X, doc.y, { align: "center", width: CW });

    doc.y += SP.s20;

    // ── B. ELECTION TITLE SECTION ──────────────────────────────────────────────
    hLine(doc, X, X + CW, doc.y, DS.color.rule, 0.5);
    doc.y += SP.s12;

    doc
      .font("Helvetica-Bold")
      .fontSize(DS.type.elecName)
      .fillColor(DS.color.dark)
      .text(election.title, X, doc.y, { width: CW, align: "center" });

    doc.y += SP.s6;

    // Metadata — bold, dark (was regular + muted)
    doc
      .font("Helvetica-Bold")
      .fontSize(DS.type.metaText)
      .fillColor(DS.color.dark)
      .text(
        `Code: ${election.electionCode}  ·  Status: ${summary.status}  ·  Date: ${summary.electionDate}`,
        X,
        doc.y,
        { width: CW, align: "center" },
      );

    doc.y += SP.s16;
    hLine(doc, X, X + CW, doc.y, DS.color.rule, 0.5);
    doc.y += SP.s20;

    // ── C. ELECTION SUMMARY BLOCK ──────────────────────────────────────────────
    renderSummaryBlock(doc, summary);

    // ── D. POSITION BLOCKS ─────────────────────────────────────────────────────
    for (const office of processed) {
      const rowCount = Math.max(office.candidates.length, 1);
      const blockH =
        DS.type.posTitle +
        SP.s8 +
        DS.type.winnerName +
        SP.s4 +
        DS.type.metaText +
        SP.s8 +
        ROW.hdr +
        ROW.body * rowCount +
        ROW.footer +
        SP.s32;

      if (doc.y + blockH > PG.height - PG.mB) {
        doc.addPage();
        doc.y = PG.mT;
      }

      renderPositionBlock(doc, office);
    }

    doc.end();
    doc.on("end", resolve);
  });
}