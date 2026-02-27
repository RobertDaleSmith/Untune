import { useEffect, useState } from "react";
import { getSmartViewTracks } from "../lib/commands";
import { TrackTable } from "./TrackTable";
import { useLibraryStore } from "../stores/libraryStore";
import type { Track } from "../lib/types";

interface SmartViewDetailProps {
  viewId: string;
  viewName: string;
}

export function SmartViewDetail({ viewId, viewName }: SmartViewDetailProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSmartViewTracks(viewId)
      .then((t) => {
        setTracks(t);
        useLibraryStore.getState().setStatusBarTracks(t);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [viewId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-n-700 border-t-n-300 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2 border-b border-n-800">
        <h2 className="text-sm font-medium text-n-200">{viewName}</h2>
        <span className="text-[10px] text-n-500">{tracks.length} tracks</span>
      </div>
      <TrackTable tracks={tracks} source={`smart-view:${viewId}`} />
    </div>
  );
}
