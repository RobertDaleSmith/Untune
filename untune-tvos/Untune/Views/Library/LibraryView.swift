import SwiftUI

enum LibrarySection: String, CaseIterable {
    case playlists = "Playlists"
    case artists = "Artists"
    case albums = "Albums"
    case songs = "Songs"
}

struct LibraryView: View {
    @State private var selectedSection: LibrarySection = .playlists
    @State private var tracks: [Track] = []
    @State private var playlists: [Playlist] = []

    var body: some View {
        NavigationStack {
            HStack(spacing: 0) {
                // Section picker sidebar
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(LibrarySection.allCases, id: \.self) { section in
                        Button {
                            selectedSection = section
                        } label: {
                            HStack {
                                Image(systemName: iconName(for: section))
                                    .frame(width: 30)
                                Text(section.rawValue)
                                Spacer()
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 14)
                            .background(
                                selectedSection == section
                                    ? Color.accentColor.opacity(0.2)
                                    : Color.clear,
                                in: RoundedRectangle(cornerRadius: 10)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                }
                .frame(width: 300)
                .padding(.top, 20)

                // Content area
                Group {
                    switch selectedSection {
                    case .playlists:
                        PlaylistsView(playlists: playlists)
                    case .artists:
                        ArtistsGridView(tracks: tracks)
                    case .albums:
                        AlbumsGridView(tracks: tracks)
                    case .songs:
                        SongsListView(tracks: tracks)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .navigationTitle("Library")
        }
        .onAppear {
            loadData()
        }
    }

    private func loadData() {
        tracks = (try? DatabaseManager.shared.fetchAllTracks()) ?? []
        playlists = (try? DatabaseManager.shared.fetchAllPlaylists()) ?? []
    }

    private func iconName(for section: LibrarySection) -> String {
        switch section {
        case .playlists: return "music.note.list"
        case .artists: return "music.mic"
        case .albums: return "square.stack"
        case .songs: return "music.note"
        }
    }
}
