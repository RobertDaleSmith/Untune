import SwiftUI

struct SongsListView: View {
    let tracks: [Track]
    @Environment(AudioPlayer.self) private var audioPlayer
    @State private var searchText = ""

    private var filteredTracks: [Track] {
        if searchText.isEmpty {
            return tracks
        }
        let query = searchText.lowercased()
        return tracks.filter {
            $0.title.lowercased().contains(query) ||
            ($0.artist?.lowercased().contains(query) ?? false) ||
            ($0.album?.lowercased().contains(query) ?? false)
        }
    }

    var body: some View {
        if tracks.isEmpty {
            ContentUnavailableView(
                "No Songs",
                systemImage: "music.note",
                description: Text("Sync with your desktop to see songs here.")
            )
        } else {
            VStack(spacing: 0) {
                // Play all / Shuffle header
                HStack(spacing: 20) {
                    Text("\(tracks.count) songs")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        audioPlayer.play(tracks: filteredTracks)
                    } label: {
                        Label("Play All", systemImage: "play.fill")
                    }
                    Button {
                        if !audioPlayer.shuffle { audioPlayer.toggleShuffle() }
                        let randomIndex = Int.random(in: 0..<max(1, filteredTracks.count))
                        audioPlayer.play(tracks: filteredTracks, startIndex: randomIndex)
                    } label: {
                        Label("Shuffle", systemImage: "shuffle")
                    }
                }
                .padding(.horizontal, 40)
                .padding(.vertical, 10)

                List(Array(filteredTracks.enumerated()), id: \.element.id) { index, track in
                    Button {
                        audioPlayer.play(tracks: filteredTracks, startIndex: index)
                    } label: {
                        TrackRow(track: track)
                    }
                }
                .searchable(text: $searchText, prompt: "Search songs")
            }
        }
    }
}
