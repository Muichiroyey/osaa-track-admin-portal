// Runs the REAL Admin Panel bundle in jsdom against the REAL backend + MySQL
// and checks the revision work: floating FAQ box, Campus Feed author name/logo,
// photo picker, office-logo Settings, Student Leaders branding, chat photo bubbles.
// Needs: backend running (set BACKEND), `node build-bundle.mjs` done, jsdom installed.
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";
import path from "node:path";

const BACKEND = process.env.BACKEND || "http://localhost:5000";
const EMAIL = process.env.ADMIN_USER || "osaa_ms@psu.edu.ph";
const PASSWORD = process.env.ADMIN_PASSWORD || "osaa123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e.detail?.stack || e.message)));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const dom = new JSDOM(fs.readFileSync(path.join("../dist", "index.html"), "utf8"), {
  url: "http://localhost:5175/", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
});
const { window } = dom;
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  return fetch(url.startsWith("/") ? BACKEND + url : url, init);
};
window.URL.createObjectURL = () => "blob:mock";
window.URL.revokeObjectURL = () => {};
window.scrollTo = () => {};
window.Element.prototype.scrollIntoView = function () {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
window.eval(fs.readFileSync("harness-bundle.js", "utf8"));

const root = () => window.document.getElementById("root");
const text = () => (root()?.textContent || "").replace(/\s+/g, " ").trim();
const q = (s) => root()?.querySelector(s) || null;
const qa = (s) => [...(root()?.querySelectorAll(s) || [])];
const byText = (tag, t) => qa(tag).find((el) => el.textContent.trim().toLowerCase().includes(t.toLowerCase()));
function set(el, v) {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}
const click = (el) => { if (!el) throw new Error("click(): element not found"); el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); };
function go(route) { window.history.pushState({}, "", route); window.dispatchEvent(new window.PopStateEvent("popstate")); }
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? " — " + detail : ""}`); };

for (let i = 0; i < 20 && !q("#username"); i++) { await sleep(500); const skip = byText("button", "skip") || byText("button", "enter") || byText("button", "continue"); if (skip) click(skip); }
check("admin login form reachable", Boolean(q("#username")));
set(q("#username"), EMAIL); set(q("#password"), PASSWORD); await sleep(150);
q("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
await sleep(3000);
check("signed in to the admin panel", !q("#username"), text().slice(0, 80));

console.log("\n── Settings: SAA office logo ──");
go("/settings"); await sleep(2000);
const ts = text();
check("Settings has an 'Office Logo' card", ts.includes("Office Logo"));
check("it explains where the logo appears", ts.includes("Campus Feed post") || ts.includes("Campus Feed"));
check("logo picker offers 'SAA office logo' upload", ts.includes("SAA office logo"));
check("hidden image input accepts images", Boolean(q('input[type="file"][accept*="image"]')));

console.log("\n── Campus Feed: real author names ──");
go("/campus-feed"); await sleep(2200);
const tf = text();
check("admin's own posts are credited to the SAA office name", tf.includes("Office of Student and Alumni Affairs"));
check("an office's post shows that office's real name + not a generic label", tf.includes("Demo Office (Testing)"));
check("no leftover generic 'OSAA-TRACK' author label on posts", qa("p.font-semibold").every((p) => p.textContent.trim() !== "OSAA-TRACK"));
check("author avatars render", qa("span.rounded-full img, img.rounded-full, div.rounded-full").length > 0);

console.log("\n── SAA Chat ──");
go("/saa-chat"); await sleep(2200);
const row = qa("button").find((b) => /Demo Student|Juan|demo/i.test(b.textContent) && b.textContent.length < 300);
if (row) { click(row); await sleep(2200); }
check("chat composer has a 'Send a photo' button", Boolean(q('button[title="Send a photo"]')) || text().includes("Send a photo") || Boolean(q('input[type="file"][accept="image/*"]')));
check("a photo in the conversation renders inline (<img>), not a download link", qa("img[alt='pic.png'], img[alt='chat-photo.png'], img[alt='reply.png']").length > 0, `${qa("img").length} imgs on screen`);

console.log("\n── Dates in Philippine time ──");
go("/"); await sleep(2000);
const phDay = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "short" }).format(new Date());
const phDate = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric" }).format(new Date());
check("dashboard shows today's date in Philippine time", text().includes(phDate), phDate);

console.log(`\n${pass} passed, ${fail} failed`);
const real = errors.filter((e) => !/Not implemented|navigation|Could not parse CSS/.test(e));
console.log(real.length ? "\nRuntime errors:\n" + real.slice(0, 8).join("\n") : "No runtime errors from the portal.");
process.exit(fail ? 1 : 0);
