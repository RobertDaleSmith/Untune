import SwiftUI

struct TrackRow: View {
    let track: Track
    let isPlaying: Bool

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                ArtworkView(track.artworkHash, size: 44)

                if isPlaying {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(.black.opacity(0.4))
                        .frame(width: 44, height: 44)

                    EqualizerBars()
                        .frame(width: 20, height: 16)
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(track.title)
                    .font(.body)
                    .fontWeight(isPlaying ? .semibold : .regular)
                    .foregroundStyle(isPlaying ? Color.accentColor : .primary)
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
                .monospacedDigit()
        }
        .contentShape(Rectangle())
    }
}

private struct EqualizerBars: View {
    @State private var animate = false

    var body: some View {
        HStack(spacing: 2) {
            EqualizerBar(speed: 0.5, animate: animate)
            EqualizerBar(speed: 0.35, animate: animate)
            EqualizerBar(speed: 0.6, animate: animate)
        }
        .onAppear { animate = true }
    }
}

private struct EqualizerBar: View {
    let speed: Double
    let animate: Bool

    @State private var height: CGFloat = 0.3

    var body: some View {
        RoundedRectangle(cornerRadius: 1)
            .fill(Color.accentColor)
            .frame(width: 3)
            .scaleEffect(y: height, anchor: .bottom)
            .onAppear {
                withAnimation(
                    .easeInOut(duration: speed)
                    .repeatForever(autoreverses: true)
                ) {
                    height = 1.0
                }
            }
    }
}
