import { useState, useCallback } from "react";
import { useLibraryStore } from "../stores/libraryStore";

interface StarRatingProps {
  trackId: number;
  rating: number | null;
}

export function StarRating({ trackId, rating }: StarRatingProps) {
  const [hoverStar, setHoverStar] = useState<number | null>(null);
  const updateTrackRating = useLibraryStore((s) => s.updateTrackRating);

  const currentStars = rating ? Math.round(rating / 20) : 0;
  const displayStars = hoverStar ?? currentStars;

  const handleClick = useCallback(
    (star: number, e: React.MouseEvent) => {
      e.stopPropagation();
      // Click same star to clear rating
      const newRating = star === currentStars ? null : star;
      updateTrackRating(trackId, newRating);
    },
    [trackId, currentStars, updateTrackRating],
  );

  return (
    <span
      className="inline-flex gap-0 cursor-pointer"
      onMouseLeave={() => setHoverStar(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={`text-[11px] leading-none px-[1px] py-1 ${
            star <= displayStars ? "text-accent" : "text-n-600"
          } hover:text-accent`}
          onMouseEnter={() => setHoverStar(star)}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          onClick={(e) => handleClick(star, e)}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {star <= displayStars ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}
