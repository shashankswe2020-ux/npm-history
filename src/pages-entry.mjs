export default {
  fetch(request, environment) {
    const url = new URL(request.url);
    if (
      url.pathname === "/svg" ||
      url.pathname.startsWith("/api/") ||
      url.pathname === "/healthz"
    ) {
      return environment.HISTORY_API.fetch(request);
    }
    return environment.ASSETS.fetch(request);
  },
};
