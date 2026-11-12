import { permanentRedirect } from "next/navigation";

// /v2 was where the video-thumbnail step 2 was reviewed. It is now the main site at "/",
// so old /v2 links land there.
export default function V2() {
  permanentRedirect("/");
}
