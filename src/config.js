export const getSocketUrl = () => {
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.hostname}${
      window.location.port ? `:${window.location.port}` : ""
    }`;
  }
  // For server-side, use environment variable or fallback
  const serverUrl = process.env.PUBLIC_URL || "http://localhost:8080";
  return serverUrl.replace(/^http/, "ws").replace(/^https/, "wss");
};
