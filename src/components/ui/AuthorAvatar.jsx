import ProtectedImage from "./ProtectedImage.jsx";
import saaSeal from "../../assets/saa-seal.png";

function initialsOf(name) {
  const words = String(name || "").replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "O";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * The round logo beside a Campus Feed post (and the "Post as ..." composer).
 *
 * Every post comes from the API with `author_name` and `author_logo`:
 *   - an office's post  → that office's logo (set in its Settings) …
 *   - the admin's post  → the SAA office logo (set in the admin's Settings) …
 *   - no logo uploaded  → the SAA seal for SAA posts, and the office's
 *                          initials for an office (never someone else's face).
 * Pass `logo` + `name` + `isOffice` directly for places that aren't a post
 * (the composer header).
 */
export default function AuthorAvatar({ post, logo, name, isOffice, className = "size-10" }) {
  const authorLogo = logo !== undefined ? logo : post?.author_logo;
  const authorName = name ?? post?.author_name ?? post?.author_office_name;
  const office = isOffice ?? post?.author_type === "office";

  const fallback = office ? (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-brand-blue text-xs font-bold text-white ${className}`}>
      {initialsOf(authorName)}
    </div>
  ) : (
    <img src={saaSeal} alt="" className={`shrink-0 rounded-full border border-slate-100 object-cover ${className}`} />
  );

  if (!authorLogo) return fallback;
  return (
    <span className={`block shrink-0 overflow-hidden rounded-full border border-slate-200 bg-white ${className}`}>
      <ProtectedImage file={authorLogo} alt="" className="size-full" fallback={fallback} />
    </span>
  );
}
