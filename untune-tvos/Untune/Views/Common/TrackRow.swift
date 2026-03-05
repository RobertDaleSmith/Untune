import SwiftUI

struct TrackRow: View {
    let track: Track
    let showArtwork: Bool
    let showTrackNumber: Bool

    init(track: Track, showArtwork: Bool = true, showTrackNumber: Bool = false) {
        self.track = track
        self.showArtwork = showArtwork
        self.showTrackNumber = showTrackNumber
    }

    var body: some View {
        HStack(spacing: 20) {
            if showTrackNumber {
                Text("\(track.trackNumber ?? 0)")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 40, alignment: .trailing)
            }

            if showArtwork {
                ArtworkView(artworkHash: track.artworkHash, size: 80, cornerRadius: 8)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(track.title)
                    .font(.body)
                    .lineLimit(1)
                Text(track.displayArtist)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Text(track.formattedDuration)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}
