export function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    // youtube.com/watch?v=ID or music.youtube.com/watch?v=ID
    if (
      (u.hostname === "www.youtube.com" ||
        u.hostname === "youtube.com" ||
        u.hostname === "music.youtube.com") &&
      u.pathname === "/watch"
    ) {
      return u.searchParams.get("v");
    }
    // youtube.com/embed/ID
    if (
      (u.hostname === "www.youtube.com" || u.hostname === "youtube.com") &&
      u.pathname.startsWith("/embed/")
    ) {
      return u.pathname.split("/")[2] || null;
    }
    // youtu.be/ID
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1) || null;
    }
  } catch {
    // not a valid URL
  }
  return null;
}

export function buildYouTubeEmbedUrl(videoId: string, startSeconds = 0): string {
  const start = Math.floor(startSeconds);
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&mute=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}&start=${start}`;
}
