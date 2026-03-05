import SwiftUI

struct AlbumDetailView: View {
    let album: AlbumInfo
    let allTracks: [Track]
    @Environment(AudioPlayer.self) private var audioPlayer

    private var albumTracks: [Track] {
        allTracks
            .filter { $0.displayAlbum == album.name && $0.displayArtist == album.artist }
            .sorted {
                ($0.discNumber ?? 1, $0.trackNumber ?? 0) < ($1.discNumber ?? 1, $1.trackNumber ?? 0)
            }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 60) {
            // Album info panel
            VStack(spacing: 20) {
                ArtworkView(artworkHash: album.artworkHash, size: 400, cornerRadius: 20)

                Text(album.name)
                    .font(.title3)
                    .multilineTextAlignment(.center)
                Text(album.artist)
                    .font(.body)
                    .foregroundStyle(.secondary)
                if let year = album.year {
                    Text("\(year)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 20) {
                    Button {
                        audioPlayer.play(tracks: albumTracks)
                    } label: {
                        Label("Play", systemImage: "play.fill")
                    }

                    Button {
                        if !audioPlayer.shuffle { audioPlayer.toggleShuffle() }
                        let randomIndex = Int.random(in: 0..<max(1, albumTracks.count))
                        audioPlayer.play(tracks: albumTracks, startIndex: randomIndex)
                    } label: {
                        Label("Shuffle", systemImage: "shuffle")
                    }
                }
            }
            .frame(width: 400)
            .padding(.top, 40)

            // Track list
            List(Array(albumTracks.enumerated()), id: \.element.id) { index, track in
                Button {
                    audioPlayer.play(tracks: albumTracks, startIndex: index)
                } label: {
                    TrackRow(track: track, showArtwork: false, showTrackNumber: true)
                }
            }
        }
        .padding(.leading, 40)
    }
}
