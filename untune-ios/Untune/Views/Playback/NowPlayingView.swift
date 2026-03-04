import SwiftUI
import UIKit

struct NowPlayingView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dismiss) private var dismiss
    @Binding var pendingArtist: String?
    @Binding var pendingAlbum: String?
    @State private var showQueue = false
    @State private var isDragging = false
    @State private var dragPosition: Double = 0
    @State private var dismissOffset: CGFloat = 0

    private var tintColor: Color {
        audioPlayer.accentColor ?? (colorScheme == .dark ? .white : .black)
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
                .saturation(colorScheme == .dark ? 1.6 : 1.2)
                .brightness(colorScheme == .dark ? 0.0 : 0.25)
                .overlay(
                    colorScheme == .dark
                        ? Color.black.opacity(0.35)
                        : Color.white.opacity(0.55)
                )
                .ignoresSafeArea()

                VStack(spacing: 0) {
                    // Dismiss handle
                    RoundedRectangle(cornerRadius: 2.5)
                        .fill(.primary.opacity(0.3))
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

                        Button {
                            let artist = track.albumArtist.nonEmpty ?? track.artist.nonEmpty ?? track.displayArtist
                            pendingArtist = artist
                            dismiss()
                        } label: {
                            Text(track.displayArtist)
                                .font(.title3)
                                .foregroundStyle(.primary.opacity(0.85))
                                .lineLimit(1)
                        }

                        if let album = track.album.nonEmpty {
                            Button {
                                pendingAlbum = album
                                dismiss()
                            } label: {
                                Text(album)
                                    .font(.subheadline)
                                    .foregroundStyle(.primary.opacity(0.5))
                                    .lineLimit(1)
                            }
                        } else {
                            Text(" ")
                                .font(.subheadline)
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.bottom, 16)

                    // Scrubber
                    VStack(spacing: 4) {
                        GeometryReader { geo in
                            let fraction = audioPlayer.duration > 0 ? displayPosition / audioPlayer.duration : 0
                            let thumbX = geo.size.width * fraction

                            ZStack(alignment: .leading) {
                                // Track background
                                Capsule()
                                    .fill(.primary.opacity(0.2))
                                    .frame(height: 4)

                                // Filled portion
                                Capsule()
                                    .fill(tintColor)
                                    .frame(width: max(0, thumbX), height: 4)

                                // Thumb
                                Circle()
                                    .fill(tintColor)
                                    .frame(width: isDragging ? 16 : 8, height: isDragging ? 16 : 8)
                                    .shadow(radius: 2)
                                    .offset(x: max(0, thumbX - (isDragging ? 8 : 4)))
                                    .animation(.easeOut(duration: 0.15), value: isDragging)
                            }
                            .frame(height: geo.size.height)
                            .contentShape(Rectangle())
                            .gesture(
                                DragGesture(minimumDistance: 0)
                                    .onChanged { value in
                                        isDragging = true
                                        let frac = max(0, min(1, value.location.x / geo.size.width))
                                        dragPosition = frac * audioPlayer.duration
                                    }
                                    .onEnded { value in
                                        let frac = max(0, min(1, value.location.x / geo.size.width))
                                        audioPlayer.seekToFraction(frac)
                                        isDragging = false
                                    }
                            )
                        }
                        .frame(height: 24)

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
                                .foregroundStyle(.primary)
                        }

                        Button {
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            audioPlayer.togglePlayPause()
                        } label: {
                            Image(systemName: audioPlayer.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                                .font(.system(size: 60))
                                .foregroundStyle(.primary)
                        }

                        Button {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            audioPlayer.next()
                        } label: {
                            Image(systemName: "forward.fill")
                                .font(.title)
                                .foregroundStyle(.primary)
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
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.primary)
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
            .tint(tintColor)
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
