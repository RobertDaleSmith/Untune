import SwiftUI

private struct AlbumDestination: Hashable {
    let name: String
}

struct LibraryView: View {
    @Environment(AudioPlayer.self) private var audioPlayer
    @Environment(SyncEngine.self) private var syncEngine
    @State private var playlists: [Playlist] = []
    @State private var allTracks: [Track] = []
    @State private var selectedTab = 1
    @State private var showSettings = false
    @State private var scrollTracker = ScrollTracker()
    @State private var navigationPath = NavigationPath()
    @Binding var pendingArtist: String?
    @Binding var pendingAlbum: String?

    var body: some View {
        NavigationStack(path: $navigationPath) {
            VStack(spacing: 0) {
                HStack {
                    Text("Library")
                        .font(.title)
                        .fontWeight(.bold)
                    Spacer()
                    Button {
                        shuffleAll()
                    } label: {
                        Image(systemName: "dice.fill")
                            .font(.title3)
                    }
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
            .onChange(of: pendingArtist) { _, artist in
                guard let artist else { return }
                pendingArtist = nil
                selectedTab = 3
                // Small delay to let the Artists tab render before pushing
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    navigationPath.append(artist)
                }
            }
            .onChange(of: pendingAlbum) { _, album in
                guard let album else { return }
                pendingAlbum = nil
                selectedTab = 2
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    navigationPath.append(AlbumDestination(name: album))
                }
            }
            .navigationDestination(for: String.self) { artistName in
                artistDetailView(for: artistName)
            }
            .navigationDestination(for: AlbumDestination.self) { dest in
                albumDetailView(for: dest.name)
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
                    .tint(.accentColor)
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

    private func shuffleAll() {
        selectedTab = 1
        if !audioPlayer.shuffle {
            audioPlayer.toggleShuffle()
        }
        guard !allTracks.isEmpty else { return }
        let randomIndex = Int.random(in: 0..<allTracks.count)
        audioPlayer.play(tracks: allTracks, startIndex: randomIndex)
    }

    @ViewBuilder
    private func artistDetailView(for artistName: String) -> some View {
        let artistTracks = allTracks.filter {
            ($0.albumArtist.nonEmpty ?? $0.artist.nonEmpty ?? "Unknown Artist") == artistName
        }.sorted { $0.title < $1.title }

        ArtistDetailView(artistName: artistName, tracks: artistTracks)
    }

    @ViewBuilder
    private func albumDetailView(for albumName: String) -> some View {
        let albumTracks = allTracks.filter {
            ($0.album ?? "Unknown Album") == albumName
        }.sorted {
            ($0.discNumber ?? 1, $0.trackNumber ?? 0) < ($1.discNumber ?? 1, $1.trackNumber ?? 0)
        }
        let artist = albumTracks.first?.albumArtist.nonEmpty ?? albumTracks.first?.artist.nonEmpty ?? "Unknown Artist"

        AlbumDetailView(albumName: albumName, artistName: artist, tracks: albumTracks)
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
