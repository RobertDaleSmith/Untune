import SwiftUI

struct ArtistDetailView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    let artistName: String
    let tracks: [Track]

    var body: some View {
        ScrollViewReader { proxy in
            List {
                Section {
                    VStack(spacing: 8) {
                        ArtistAvatar(name: artistName, size: 120)

                        Text(artistName)
                            .font(.title2)
                            .fontWeight(.bold)
                        Text("\(tracks.count) songs")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        Button {
                            audioPlayer.play(tracks: tracks)
                        } label: {
                            Label("Play All", systemImage: "play.fill")
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .padding(.top, 4)
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                    .padding()
                }

                Section {
                    ForEach(Array(tracks.enumerated()), id: \.element.id) { index, track in
                        TrackRow(
                            track: track,
                            isPlaying: audioPlayer.currentTrack?.id == track.id,
                            isPaused: audioPlayer.currentTrack?.id == track.id && !audioPlayer.isPlaying
                        )
                        .id(track.id)
                        .listRowBackground(Color.clear)
                        .onTapGesture {
                            audioPlayer.play(tracks: tracks, startIndex: index)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .navigationTitle(artistName)
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if let id = audioPlayer.currentTrack?.id {
                    proxy.scrollTo(id, anchor: .center)
                }
            }
        }
    }
}
