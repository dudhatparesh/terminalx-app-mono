import { describe, it, expect } from "vitest";
import { markdownToTelegramV2, asCodeBlock, splitForTelegram } from "@/lib/telegram/render";

describe("markdownToTelegramV2", () => {
  it("escapes plain text with MarkdownV2 specials", () => {
    expect(markdownToTelegramV2("a + b = c. done!")).toBe("a \\+ b \\= c\\. done\\!");
  });

  it("converts **bold** to *bold*", () => {
    expect(markdownToTelegramV2("this is **important** stuff")).toBe("this is *important* stuff");
  });

  it("converts *italic* and _italic_ to _italic_", () => {
    expect(markdownToTelegramV2("an *italic* word")).toBe("an _italic_ word");
    expect(markdownToTelegramV2("an _italic_ word")).toBe("an _italic_ word");
  });

  it("keeps snake_case identifiers intact outside backticks", () => {
    expect(markdownToTelegramV2("set max_borrow_utilization high")).toBe(
      "set max\\_borrow\\_utilization high"
    );
  });

  it("converts inline code, escaping only backtick/backslash inside", () => {
    expect(markdownToTelegramV2("run `npm test -- --watch` now")).toBe(
      "run `npm test -- --watch` now"
    );
    expect(markdownToTelegramV2("path `C:\\x`")).toBe("path `C:\\\\x`");
  });

  it("converts fenced code blocks and keeps the language tag", () => {
    expect(markdownToTelegramV2("before\n```bash\nls -la | grep *.ts\n```\nafter")).toBe(
      "before\n```bash\nls -la | grep *.ts\n```\nafter"
    );
  });

  it("closes an unterminated fence so the message stays valid", () => {
    const out = markdownToTelegramV2("```\necho hi");
    expect(out).toBe("```\necho hi\n```");
  });

  it("does not treat fence content as markdown", () => {
    const out = markdownToTelegramV2("```\n**not bold** _not italic_\n```");
    expect(out).toBe("```\n**not bold** _not italic_\n```");
  });

  it("turns headers into bold lines", () => {
    expect(markdownToTelegramV2("## Results\nok")).toBe("*Results*\nok");
  });

  it("turns dash bullets into bullet points", () => {
    expect(markdownToTelegramV2("- first\n- second.")).toBe("• first\n• second\\.");
  });

  it("converts links and escapes the label", () => {
    expect(markdownToTelegramV2("[a.b](https://x.io/p_q)")).toBe("[a\\.b](https://x.io/p_q)");
  });

  it("converts ~~strikethrough~~", () => {
    expect(markdownToTelegramV2("~~gone~~")).toBe("~gone~");
  });

  it("supports nested formatting inside bold", () => {
    expect(markdownToTelegramV2("**bold `code`**")).toBe("*bold `code`*");
  });

  it("converts blockquotes", () => {
    expect(markdownToTelegramV2("> quoted text.")).toBe(">quoted text\\.");
  });

  it("does not italicize a lone asterisk or multiplication", () => {
    expect(markdownToTelegramV2("2 * 3 = 6")).toBe("2 \\* 3 \\= 6");
  });
});

describe("asCodeBlock", () => {
  it("wraps text in a fence and escapes backticks", () => {
    expect(asCodeBlock("echo `hi`")).toBe("```\necho \\`hi\\`\n```");
  });
});

describe("markdownToTelegramV2 — adversarial inputs (verified accepted by Telegram 2026-06-19)", () => {
  // Each of these was POSTed to a live forum topic with parse_mode=MarkdownV2
  // and accepted (ok=true). We can't re-check Telegram offline, but the
  // invariant Telegram enforces — balanced code fences and no converter
  // throw — is asserted here so a future regex change can't silently break
  // these without tripping a test.
  const inputs: Record<string, string> = {
    "unbalanced asterisks": "a single * here and ** two there, no close",
    "underscore-heavy code": "`a_b_c_d` and bare a_b_c_d outside",
    "nested bold+italic+code": "**bold _ital `co_de` ital_ bold**",
    "url with underscores": "see https://x.io/a_b_c?d=e_f for details",
    "markdown table": "| col_a | col_b |\n|-------|-------|\n| 1 | 2 |",
    "double backtick inline": "use ``arr[`x`]`` carefully",
    "brackets and parens prose": "array[0] and func(x, y) and {a: 1}",
    "fence no lang + inner backtick": "```\nprintf '`%s`\\n' hi\n```",
    "hr + heading#noSpace": "---\n#nospace heading\ntext",
    "emoji + escapes": "done ✅ 100% \\o/ <tag> & more!",
  };

  for (const [name, md] of Object.entries(inputs)) {
    it(`converts without throwing and keeps fences balanced: ${name}`, () => {
      let out = "";
      expect(() => {
        out = markdownToTelegramV2(md);
      }).not.toThrow();
      const fences = out.split("\n").filter((l) => l.trim().startsWith("```")).length;
      expect(fences % 2).toBe(0);
    });
  }

  it("renders a fenced code block's contents literally (no inner markdown/escape noise)", () => {
    // Snake_case and asterisks inside a fence must survive untouched.
    expect(markdownToTelegramV2("```\nrm *_tmp\n```")).toBe("```\nrm *_tmp\n```");
  });
});

describe("splitForTelegram", () => {
  it("returns short messages untouched", () => {
    expect(splitForTelegram("hello")).toEqual(["hello"]);
  });

  it("re-opens code fences across chunk boundaries", () => {
    const longCode = "```\n" + "x".repeat(60) + "\n" + "y".repeat(60) + "\n```";
    const chunks = splitForTelegram(longCode, 80);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.startsWith("```")).toBe(true);
      expect(c.endsWith("```")).toBe(true);
    }
  });
});
