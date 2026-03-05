import SwiftUI

struct PlaylistsView: View {
    let playlists: [Playlist]
    @Environment(AudioPlayer.self) private var audioPlayer

    var body: some View {
        if playlists.isEmpty {
            ContentUnavailableView(
                "No Playlists",
                systemImage: "music.note.list",
                description: Text("Sync with your desktop to see playlists here.")
            )
        } else {
            List(playlists) { playlist in
                NavigationLink(value: playlist) {
                    HStack(spacing: 16) {
                        Image(systemName: playlist.isSmart ? "gear" : "music.note.list")
                            .font(.title2)
                            .foregroundStyle(.secondary)
                            .frame(width: 40)
                        VStack(alignment: .leading) {
                            Text(playlist.name)
                                .font(.body)
                            Text("\(playlist.trackCount) tracks")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationDestination(for: Playlist.self) { playlist in
                PlaylistDetailView(playlist: playlist)
            }
        }
    }
}
