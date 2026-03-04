import SwiftUI
import UIKit

struct NowPlayingView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    @Environment(\.dismiss) private var dismiss
    @State private var showQueue = false
    @State private var isDragging = false
    @State private var dragPosition: Double = 0
    @State private var dismissOffset: CGFloat = 0

    private var tintColor: Color {
        audioPlayer.accentColor ?? .white
    }

    private var displayPosition: Double {
        isDragging ? dragPosition : audioPlayer.position
    }

    var body: some View {
        if let track = audioPlayer.currentTrack {
            ZStack {
                // Blurred artwork background
                Group {
                    if let image = audioPlayer.artworkImage {
                        GeometryReader { geo in
                            Image(uiImage: image)
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(width: geo.size.width, height: geo.size.height)
                                .clipped()
                        }
                    } else {
                        Color.black
                    }
                }
                .blur(radius: 60)
                .saturation(1.6)
                .overlay(Color.black.opacity(0.35))
                .ignoresSafeArea()

                VStack(spacing: 0) {
                    // Dismiss handle
                    RoundedRectangle(cornerRadius: 2.5)
                        .fill(.white.opacity(0.5))
                        .frame(width: 36, height: 5)
                        .padding(.top, 12)
                        .padding(.bottom, 8)

                    Spacer()

                    // Artwork
                    ArtworkView(track.artworkHash, size: 260)
                        .shadow(radius: 20)
                        .padding(.bottom, 24)

                    // Track info
                    VStack(spacing: 4) {
                        MarqueeText(track.title, font: .title2.bold())

                        Text(track.displayArtist)
                            .font(.title3)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)

                        if let album = track.album {
                            Text(album)
                                .font(.subheadline)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.bottom, 16)

                    // Scrubber
                    VStack(spacing: 4) {
                        Slider(
                            value: Binding(
                                get: { audioPlayer.duration > 0 ? displayPosition / audioPlayer.duration : 0 },
                                set: { newValue in
                                    dragPosition = newValue * audioPlayer.duration
                                    if !isDragging {
                                        audioPlayer.seekToFraction(newValue)
                                    }
                                }
                            ),
                            in: 0...1,
                            onEditingChanged: { editing in
                                isDragging = editing
                                if !editing {
                                    audioPlayer.seek(to: dragPosition)
                                }
                            }
                        )
                        .tint(tintColor)

                        HStack {
                            Text(TimeFormatting.format(seconds: displayPosition))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                            Spacer()
                            Text("-" + TimeFormatting.format(seconds: max(0, audioPlayer.duration - displayPosition)))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.bottom, 16)

                    // Transport controls
                    HStack(spacing: 20) {
                        Button { audioPlayer.toggleShuffle() } label: {
                            Image(systemName: "shuffle")
                                .font(.title3)
                                .foregroundStyle(audioPlayer.shuffle ? tintColor : .secondary)
                        }

                        Button {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            audioPlayer.previous()
                        } label: {
                            Image(systemName: "backward.fill")
                                .font(.title)
                                .foregroundStyle(.white)
                        }

                        Button {
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            audioPlayer.togglePlayPause()
                        } label: {
                            Image(systemName: audioPlayer.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                                .font(.system(size: 60))
                                .foregroundStyle(.white)
                        }

                        Button {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            audioPlayer.next()
                        } label: {
                            Image(systemName: "forward.fill")
                                .font(.title)
                                .foregroundStyle(.white)
                        }

                        Button { audioPlayer.cycleRepeat() } label: {
                            Image(systemName: audioPlayer.repeatMode.icon)
                                .font(.title3)
                                .foregroundStyle(audioPlayer.repeatMode.isActive ? tintColor : .secondary)
                        }
                    }
                    .padding(.bottom, 16)

                    // Queue button
                    Button { showQueue = true } label: {
                        Label("Up Next", systemImage: "list.bullet")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()
                }
            }
            .offset(y: dismissOffset)
            .gesture(
                DragGesture()
                    .onChanged { value in
                        if value.translation.height > 0 {
                            dismissOffset = value.translation.height
                        }
                    }
                    .onEnded { value in
                        if value.translation.height > 120 || value.predictedEndTranslation.height > 300 {
                            dismiss()
                        } else {
                            withAnimation(.interactiveSpring) {
                                dismissOffset = 0
                            }
                        }
                    }
            )
            .animation(.interactiveSpring, value: dismissOffset)
            .tint(audioPlayer.accentColor ?? .white)
            .sheet(isPresented: $showQueue) {
                QueueView()
            }
        } else {
            VStack(spacing: 16) {
                Image(systemName: "music.note")
                    .font(.system(size: 60))
                    .foregroundStyle(.tertiary)
                Text("Not Playing")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                Text("Select a song from your library")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}
