import SwiftUI

struct PlaylistDetailView: View {
    let playlist: Playlist
    @Environment(AudioPlayer.self) private var audioPlayer
    @State private var tracks: [Track] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            // Header with play/shuffle buttons
            HStack(spacing: 20) {
                VStack(alignment: .leading) {
                    Text(playlist.name)
                        .font(.title2)
                    Text("\(tracks.count) tracks")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button {
                    audioPlayer.play(tracks: tracks)
                } label: {
                    Label("Play", systemImage: "play.fill")
                }

                Button {
                    if !audioPlayer.shuffle { audioPlayer.toggleShuffle() }
                    let randomIndex = Int.random(in: 0..<max(1, tracks.count))
                    audioPlayer.play(tracks: tracks, startIndex: randomIndex)
                } label: {
                    Label("Shuffle", systemImage: "shuffle")
                }
            }
            .padding(.horizontal, 40)

            // Track list
            List(Array(tracks.enumerated()), id: \.element.id) { index, track in
                Button {
                    audioPlayer.play(tracks: tracks, startIndex: index)
                } label: {
                    TrackRow(track: track, showTrackNumber: true)
                }
            }
        }
        .onAppear {
            tracks = (try? DatabaseManager.shared.fetchTracks(forPlaylist: playlist.id)) ?? []
        }
    }
}
