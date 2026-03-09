import SwiftUI

struct TrackRow: View {
    let track: Track
    let isPlaying: Bool
    var isPaused: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                ArtworkView(track.artworkHash, size: 44)

                if isPlaying {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(.black.opacity(0.4))
                        .frame(width: 44, height: 44)

                    EqualizerBars(animating: !isPaused)
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
    var animating: Bool

    var body: some View {
        HStack(spacing: 2) {
            EqualizerBar(speed: 0.5, restHeight: 0.4, animating: animating)
            EqualizerBar(speed: 0.35, restHeight: 0.6, animating: animating)
            EqualizerBar(speed: 0.6, restHeight: 0.3, animating: animating)
        }
    }
}

private struct EqualizerBar: View {
    let speed: Double
    let restHeight: CGFloat
    var animating: Bool

    @State private var height: CGFloat = 0.3

    var body: some View {
        RoundedRectangle(cornerRadius: 1)
            .fill(Color.accentColor)
            .frame(width: 3)
            .scaleEffect(y: height, anchor: .bottom)
            .onChange(of: animating) { _, active in
                if active {
                    withAnimation(
                        .easeInOut(duration: speed)
                        .repeatForever(autoreverses: true)
                    ) {
                        height = 1.0
                    }
                } else {
                    withAnimation(.easeOut(duration: 0.3)) {
                        height = restHeight
                    }
                }
            }
            .onAppear {
                if animating {
                    withAnimation(
                        .easeInOut(duration: speed)
                        .repeatForever(autoreverses: true)
                    ) {
                        height = 1.0
                    }
                } else {
                    height = restHeight
                }
            }
    }
}
