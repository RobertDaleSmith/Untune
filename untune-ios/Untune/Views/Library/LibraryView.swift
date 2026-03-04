import SwiftUI

struct LibraryView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    @Environment(SyncEngine.self) private var syncEngine
    @State private var playlists: [Playlist] = []
    @State private var allTracks: [Track] = []
    @State private var selectedTab = 1
    @State private var showSettings = false
    @State private var scrollTracker = ScrollTracker()

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Text("Library")
                        .font(.title)
                        .fontWeight(.bold)
                    Spacer()
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gear")
                            .font(.title3)
                    }
                }
                .padding(.horizontal)
                .padding(.top, 4)

                Picker("View", selection: $selectedTab) {
                    Text("Playlists").tag(0)
                    Text("Songs").tag(1)
                    Text("Albums").tag(2)
                    Text("Artists").tag(3)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)

                switch selectedTab {
                case 0:
                    playlistsList
                case 1:
                    allSongsList
                case 2:
                    AlbumsView(tracks: allTracks)
                case 3:
                    ArtistsView(tracks: allTracks)
                default:
                    EmptyView()
                }
            }
            .background(TransparentBackground())
            .toolbar(.hidden, for: .navigationBar)
            .onAppear(perform: loadData)
            .onChange(of: syncEngine.state) { oldState, newState in
                if newState == .done {
                    loadData()
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
        }
    }

    private var playlistsList: some View {
        List {
            ForEach(playlists) { playlist in
                NavigationLink(destination: PlaylistDetailView(playlist: playlist)) {
                    HStack {
                        Image(systemName: "music.note.list")
                            .font(.title3)
                            .foregroundStyle(Color.accentColor)
                            .frame(width: 32)

                        VStack(alignment: .leading) {
                            Text(playlist.name)
                                .font(.body)
                            Text("\(playlist.trackCount) tracks")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private var allSongsList: some View {
        ScrollViewReader { proxy in
            List {
                ForEach(Array(allTracks.enumerated()), id: \.element.id) { index, track in
                    TrackRow(
                        track: track,
                        isPlaying: audioPlayer.currentTrack?.id == track.id
                    )
                    .id(track.id)
                    .listRowBackground(Color.clear)
                    .onTapGesture {
                        audioPlayer.play(tracks: allTracks, startIndex: index)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .simultaneousGesture(
                DragGesture(minimumDistance: 5)
                    .onChanged { _ in scrollTracker.dragChanged() }
                    .onEnded { _ in scrollTracker.dragEnded() }
            )
            .onAppear {
                if let id = audioPlayer.currentTrack?.id {
                    proxy.scrollTo(id, anchor: .center)
                }
            }
            .onChange(of: audioPlayer.currentTrack?.id) { _, newId in
                guard let newId, !scrollTracker.userIsScrolling else { return }
                withAnimation {
                    proxy.scrollTo(newId, anchor: .center)
                }
            }
        }
    }

    private func loadData() {
        do {
            playlists = try DatabaseManager.shared.fetchAllPlaylists()
            allTracks = try DatabaseManager.shared.fetchAllTracks()
        } catch {
            print("Failed to load library: \(error)")
        }
    }
}
