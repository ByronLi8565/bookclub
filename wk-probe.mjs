import { webkit } from "playwright";
try {
  const b = await webkit.launch();
  const p = await b.newPage();
  await p.setContent("<h1>ok</h1>");
  console.log("TITLE:", await p.textContent("h1"));
  await b.close();
  console.log("WEBKIT OK");
} catch (e) {
  console.log("WEBKIT FAILED:", e.message.slice(0, 2000));
}
