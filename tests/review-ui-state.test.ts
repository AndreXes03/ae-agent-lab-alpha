import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";

async function ui(kind: "video" | "storyboard") {
  const html = await readFile(
    new URL(`../assets/${kind === "video" ? "review" : "storyboard"}.html`, import.meta.url),
    "utf8",
  );
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const elements: Record<string, any> = {};
  const keydowns: Function[] = [];
  let serial = 0;
  const element = (id: string): any =>
    (elements[id] ??= {
      id,
      value: "",
      textContent: "",
      style: {},
      dataset: {},
      children: [],
      files: [],
      hidden: true,
      disabled: false,
      paused: true,
      currentTime: 1,
      duration: 5,
      videoWidth: 1920,
      videoHeight: 1080,
      readyState: 1,
      offsetWidth: 300,
      offsetHeight: 180,
      focus() {},
      setAttribute() {},
      setPointerCapture() {},
      addEventListener() {},
      pause() {
        this.paused = true;
      },
      append(...nodes: any[]) {
        this.children.push(...nodes);
      },
      replaceChildren() {
        this.children = [];
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
      querySelectorAll() {
        return this.children.filter((n: any) => n.className === "thumb");
      },
      classList: { toggle() {}, contains: () => false },
      click() {
        this.onclick?.();
      },
    });
  const videoContext = {
    video: "video.mp4",
    videoDigest: "abc",
    compId: "42",
    compName: "Delivery",
    fps: 30,
    startFrame: 0,
    version: "v3",
  };
  const board = JSON.parse(
    await readFile(new URL("../examples/storyboard/kynem-demo.json", import.meta.url), "utf8"),
  );
  const contextData =
    kind === "video"
      ? videoContext
      : {
          spec: board,
          manifestHash: "board-hash",
          sceneHashes: {},
          frames: board.scenes.map((s: any) => ({
            id: s.id,
            title: s.title,
            file: s.id + ".svg",
            source: "schematic",
          })),
          transitions: board.transitions,
        };
  element(kind === "video" ? "reviewContext" : "context").textContent = JSON.stringify(contextData);
  const sandbox: any = {
    document: {
      getElementById: (id: string) => (ids.has(id) ? element(id) : null),
      querySelector: () => element("layout"),
      createElement: () => element("created" + serial++),
      createTextNode: (text: string) => ({ textContent: text }),
      addEventListener: (event: string, fn: Function) => {
        if (event === "keydown") keydowns.push(fn);
      },
    },
    localStorage: { getItem: () => null, setItem() {} },
    window: { innerWidth: 1280, innerHeight: 720 },
    URL: { createObjectURL: () => "blob:video", revokeObjectURL() {} },
    Blob,
    requestAnimationFrame: () => 1,
    ResizeObserver: class {
      observe() {}
    },
    clearInterval() {},
    setTimeout() {},
    KynemCodexFeedback: {
      available: () => true,
      request: () => ({ reason: "Save the current feedback before opening it in Codex" }),
    },
  };
  createContext(sandbox);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  runInContext(scripts[0], sandbox);
  if (kind === "video") element("video").onloadedmetadata();
  const evaluate = (code: string) => runInContext(code, sandbox);
  const saveNote = () => {
    element(kind === "video" ? "video" : "artwork").onclick({ clientX: 960, clientY: 540 });
    element("note").value = "Current note";
    element(kind === "video" ? "form" : "composer").onsubmit({ preventDefault() {} });
  };
  return { element, sandbox, evaluate, saveNote, keydowns, scripts, contextData };
}

test.each(["video", "storyboard"] as const)(
  "%s hides the native handoff after edits and rejects stale async receipts",
  async (kind) => {
    const page = await ui(kind);
    page.saveNote();
    page.evaluate("codexHandoff={receipt:{feedbackId:'old'}}");
    page.element("codexFeedback").hidden = false;
    page.saveNote();
    expect(page.element("codexFeedback").hidden).toBe(true);
    expect(page.evaluate("codexHandoff")).toBeNull();
    let finish: any;
    page.sandbox.fetch = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    page.evaluate("reviewSession={sessionId:'s',token:'t',context:{}};");
    const pending = page.element("sendAgent").onclick();
    page.saveNote();
    finish({ ok: true, json: async () => ({ feedbackId: "new", status: { state: "queued" } }) });
    await pending;
    expect(page.element("codexFeedback").hidden).toBe(true);
    expect(page.evaluate("codexHandoff")).toBeNull();
    expect(page.element("status").textContent).toContain("modifiche più recenti");
  },
);

test("switching local video clears native/server context without reusing the old preview", async () => {
  const page = await ui("video");
  page.evaluate(
    "reviewSession={sessionId:'old'};reviewPoll=5;codexHandoff={receipt:{feedbackId:'old'}}",
  );
  page.element("latestPreviewLink").hidden = false;
  page.element("file").files = [{ name: "different.mp4", size: 10, lastModified: 1 }];
  page.element("file").onchange();
  expect(page.evaluate("reviewSession")).toBeNull();
  expect(page.evaluate("reviewPoll")).toBeNull();
  expect(page.evaluate("context.fps")).toBeNull();
  expect(page.element("latestPreviewLink").hidden).toBe(true);
  expect(page.element("agentState").textContent).toContain("non associata");
  page.sandbox.location = { protocol: "http:" };
  page.sandbox.fetch = async () => ({
    ok: true,
    json: async () => ({
      sessionId: "old",
      token: "t",
      context: { kind: "video", review: page.contextData },
      status: { state: "idle" },
    }),
  });
  await expect(page.evaluate("discoverReviewSession()")).rejects.toThrow("altra versione");
});

test.each(["video", "storyboard"] as const)(
  "%s localizes defaults and suspends shortcuts while writing a comment",
  async (kind) => {
    const page = await ui(kind);
    page.evaluate("showAgentState({state:'idle',message:'Ready for feedback'})");
    expect(page.element("agentHint").textContent).toBe("Pronto per il feedback");
    page.evaluate("showAgentState({state:'processing',message:'Sto rifinendo il titolo'})");
    expect(page.element("agentHint").textContent).toBe("Sto rifinendo il titolo");
    runInContext(page.scripts.at(-1)!, page.sandbox);
    page.element(kind === "video" ? "video" : "artwork").onclick({ clientX: 960, clientY: 540 });
    const before =
      kind === "video" ? page.element("video").currentTime : page.evaluate("sceneIndex");
    let prevented = false;
    page.keydowns.at(-1)!({
      key: "ArrowRight",
      target: { closest: () => null },
      preventDefault() {
        prevented = true;
      },
    });
    expect(kind === "video" ? page.element("video").currentTime : page.evaluate("sceneIndex")).toBe(
      before,
    );
    expect(prevented).toBe(false);
    page.evaluate(kind === "video" ? "closeComposer()" : "close()");
    page.keydowns.at(-1)!({
      key: "ArrowRight",
      target: { closest: () => null },
      preventDefault() {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(kind === "video" ? page.element("video").currentTime : page.evaluate("sceneIndex")).toBe(
      kind === "video" ? before + 1 / 30 : before + 1,
    );
  },
);
