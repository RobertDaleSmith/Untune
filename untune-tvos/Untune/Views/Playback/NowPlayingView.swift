import SwiftUI

struct NowPlayingView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    @Environment(PairingManager.self) private var pairingManager
    @State private var showQueue = false

    var body: some View {
        if let track = audioPlayer.currentTrack {
            ZStack {
                // Blurred artwork background
                if let image = audioPlayer.artworkImage {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .blur(radius: 80)
                        .saturation(1.5)
                        .brightness(-0.2)
                        .overlay(Color.black.opacity(0.5))
                        .ignoresSafeArea()
                }

                HStack(spacing: 80) {
                    // Artwork
                    ArtworkView(
                        artworkHash: track.artworkHash,
                        size: 500,
                        cornerRadius: 24
                    )
                    .shadow(radius: 30)

                    // Track info + controls
                    VStack(spacing: 40) {
                        Spacer()

                        // Track metadata
                        VStack(spacing: 12) {
                            Text(track.title)
                                .font(.title)
                                .fontWeight(.semibold)
                                .lineLimit(2)
                                .multilineTextAlignment(.center)
                            Text(track.displayArtist)
                                .font(.title3)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                            Text(track.displayAlbum)
                                .font(.body)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }

                        // Progress bar
                        VStack(spacing: 8) {
                            ProgressView(value: audioPlayer.progress)
                                .tint(.white)
                            HStack {
                                Text(TimeFormatting.format(seconds: audioPlayer.position))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text("-" + TimeFormatting.format(seconds: max(0, audioPlayer.duration - audioPlayer.position)))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .frame(maxWidth: 500)

                        // Buffering indicator
                        if audioPlayer.isBuffering {
                            HStack(spacing: 8) {
                                ProgressView()
                                Text("Buffering...")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        // Transport controls
                        HStack(spacing: 50) {
                            Button {
                                audioPlayer.toggleShuffle()
                            } label: {
                                Image(systemName: "shuffle")
                                    .font(.title3)
                                    .foregroundStyle(audioPlayer.shuffle ? .primary : .secondary)
                            }
                            .buttonStyle(.plain)

                            Button {
                                audioPlayer.previous()
                            } label: {
                                Image(systemName: "backward.fill")
                                    .font(.title2)
                            }
                            .buttonStyle(.plain)

                            Button {
                                audioPlayer.togglePlayPause()
                            } label: {
                                Image(systemName: audioPlayer.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                                    .font(.system(size: 70))
                            }
                            .buttonStyle(.plain)

                            Button {
                                audioPlayer.next()
                            } label: {
                                Image(systemName: "forward.fill")
                                    .font(.title2)
                            }
                            .buttonStyle(.plain)

                            Button {
                                audioPlayer.cycleRepeat()
                            } label: {
                                Image(systemName: audioPlayer.repeatMode.icon)
                                    .font(.title3)
                                    .foregroundStyle(audioPlayer.repeatMode.isActive ? .primary : .secondary)
                            }
                            .buttonStyle(.plain)
                        }

                        // Up Next button
                        Button {
                            showQueue = true
                        } label: {
                            Label("Up Next (\(audioPlayer.upNext.count))", systemImage: "list.bullet")
                                .font(.body)
                        }

                        Spacer()
                    }
                    .frame(maxWidth: 600)
                }
                .padding(60)
            }
            .sheet(isPresented: $showQueue) {
                QueueView()
            }
        } else {
            // No track playing
            VStack(spacing: 20) {
                Image(systemName: "music.note")
                    .font(.system(size: 80))
                    .foregroundStyle(.secondary)
                Text("Nothing Playing")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                Text("Select a track from your library to start listening.")
                    .font(.body)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

// MARK: - Queue View

struct QueueView: View {
    @Environment(AudioPlayer.self) private var audioPlayer

    var body: some View {
        NavigationStack {
            List(Array(audioPlayer.upNext.enumerated()), id: \.element.id) { index, track in
                Button {
                    // Play the track from the queue
                    let actualIndex = audioPlayer.queueIndex + 1 + index
                    if actualIndex < audioPlayer.queue.count {
                        audioPlayer.playTrackFromQueue(at: actualIndex)
                    }
                } label: {
                    TrackRow(track: track)
                }
            }
            .navigationTitle("Up Next")
        }
    }
}
