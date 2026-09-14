import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function Shell() {
  return (
    <main>
      <p>Wordcloud Studio</p>
      <h1>Make meaning visible.</h1>
      <p>文字只留在你的瀏覽器裡。</p>
    </main>
  );
}

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Application root is missing");
}

createRoot(root).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
