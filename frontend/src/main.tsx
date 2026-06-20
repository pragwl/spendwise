import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// NOTE: React.StrictMode intentionally double-invokes effects in development,
// which fires every initial data fetch twice. It's removed so the network tab
// reflects exactly one call per load (production behaviour was already single).
ReactDOM.createRoot(document.getElementById("root")!).render(
  <App />
);
