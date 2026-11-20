/**
 * Türkçe başlık büyütmesi: CSS `text-transform: capitalize` Chromium'da belge dilini izlemiyor; kelime başındaki "i"yi
 * "İ" yerine "I" yapıyor ("Olarak Işaretle", "Excel'den Içe Aktar"). `uppercase` dili izliyor, `capitalize` izlemiyor.
 *
 * Çözüm: Türkçe arayüzde, büyütülerek çizilen (hesaplanmış stili `capitalize` olan) öğelerdeki metinde kelime başı
 * "i" harfleri önceden "İ" yapılır. CSS zaten o harfi büyütecekti; görünen tek fark doğru noktalı İ'dir. Hangi
 * öğelerin büyütüldüğünü CSS belirler (styles.css, `.no-cap` istisnaları dahil); burada seçici listesi tekrarlanmaz.
 */
import { dotTurkishI } from "./turkishI";

const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION"]);

function fixNode(node: Text) {
  const el = node.parentElement;
  if (!el || SKIP.has(el.tagName) || el.isContentEditable) return;
  const text = node.data;
  if (!text.includes("i")) return;
  if (getComputedStyle(el).textTransform !== "capitalize") return;
  const prevText = node.previousSibling?.textContent ?? "";
  const next = dotTurkishI(text, prevText.slice(-1));
  if (next !== text) node.data = next;
}

function fixTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return fixNode(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) fixNode(n as Text);
}

/** Belgeyi izler; yeni çizilen ya da değişen metinleri düzeltir. Döndürdüğü işlev izlemeyi durdurur. */
export function watchTurkishTitleCase(root: HTMLElement = document.body): () => void {
  fixTree(root);
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") fixNode(r.target as Text);
      else r.addedNodes.forEach(fixTree);
    }
  });
  obs.observe(root, { subtree: true, childList: true, characterData: true });
  return () => obs.disconnect();
}
