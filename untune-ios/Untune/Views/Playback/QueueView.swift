import SwiftUI

struct QueueView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                // Now Playing
                if let track = audioPlayer.currentTrack {
                    Section("Now Playing") {
                        TrackRow(track: track, isPlaying: true, isPaused: !audioPlayer.isPlaying)
                    }
                }

                // Up Next
                Section("Up Next") {
                    if audioPlayer.upNext.isEmpty {
                        Text("Queue is empty")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .listRowBackground(Color.clear)
                    } else {
                        ForEach(Array(audioPlayer.upNext.enumerated()), id: \.element.id) { index, track in
                            TrackRow(
                                track: track,
                                isPlaying: false
                            )
                            .onTapGesture {
                                // Find the actual index in the queue
                                if let queueIdx = audioPlayer.queue.firstIndex(where: { $0.id == track.id }) {
                                    audioPlayer.playTrackFromQueue(at: queueIdx)
                                }
                            }
                        }
                        .onMove { source, destination in
                            audioPlayer.moveQueueItem(from: source, to: destination)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Queue")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .topBarLeading) {
                    EditButton()
                }
            }
        }
    }
}
