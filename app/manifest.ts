import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MeetingPoint",
    short_name: "MeetingPoint",
    description: "Find a fair place to meet when everyone starts from a different part of the city.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f5f7",
    theme_color: "#f3f5f7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
