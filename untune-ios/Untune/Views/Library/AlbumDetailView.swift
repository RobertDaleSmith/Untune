import SwiftUI

struct AlbumDetailView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    let albumName: String
    let artistName: String
    let tracks: [Track]

    var body: some View {
        ScrollViewReader { proxy in
            List {
                Section {
                    VStack(spacing: 8) {
                        ArtworkView(tracks.first?.artworkHash, size: 200)
                        Text(albumName)
                            .font(.title2)
                            .fontWeight(.bold)
                        Text(artistName)
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
                        HStack {
                            Text("\(track.trackNumber ?? (index + 1))")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .frame(width: 24)

                            VStack(alignment: .leading) {
                                Text(track.title)
                                    .font(.body)
                                    .foregroundStyle(audioPlayer.currentTrack?.id == track.id ? Color.accentColor : .primary)
                                if track.displayArtist != artistName {
                                    Text(track.displayArtist)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }

                            Spacer()

                            Text(track.formattedDuration)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                        .contentShape(Rectangle())
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
            .navigationTitle(albumName)
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if let id = audioPlayer.currentTrack?.id {
                    proxy.scrollTo(id, anchor: .center)
                }
            }
        }
    }
}
