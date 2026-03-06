import SwiftUI

struct PlaylistsView: View {
    let playlists: [Playlist]
    @Environment(AudioPlayer.self) private var audioPlayer
    @State private var expandedFolders: Set<Int64> = []

    /// Top-level items: folders and playlists with no parent
    private var topLevelItems: [Playlist] {
        playlists
            .filter { $0.parentId == nil }
            .sorted { $0.sortOrder < $1.sortOrder }
    }

    /// Children of a given folder
    private func children(of folderId: Int64) -> [Playlist] {
        playlists
            .filter { $0.parentId == folderId }
            .sorted { $0.sortOrder < $1.sortOrder }
    }

    /// Total track count across all non-folder playlists inside a folder (recursive)
    private func folderTrackCount(_ folderId: Int64) -> Int {
        children(of: folderId).reduce(0) { total, child in
            if child.isFolder {
                return total + folderTrackCount(child.id)
            } else {
                return total + child.trackCount
            }
        }
    }

    var body: some View {
        if playlists.isEmpty {
            ContentUnavailableView(
                "No Playlists",
                systemImage: "music.note.list",
                description: Text("Sync with your desktop to see playlists here.")
            )
        } else {
            List {
                ForEach(topLevelItems) { item in
                    if item.isFolder {
                        folderSection(item)
                    } else {
                        playlistRow(item)
                    }
                }
            }
            .navigationDestination(for: Playlist.self) { playlist in
                PlaylistDetailView(playlist: playlist)
            }
        }
    }

    @ViewBuilder
    private func folderSection(_ folder: Playlist) -> some View {
        let isExpanded = expandedFolders.contains(folder.id)
        let folderChildren = children(of: folder.id)

        Section {
            if isExpanded {
                ForEach(folderChildren) { child in
                    if child.isFolder {
                        // Nested folder: show as expandable button
                        nestedFolderRow(child)
                    } else {
                        playlistRow(child)
                    }
                }
            }
        } header: {
            Button {
                withAnimation {
                    if isExpanded {
                        expandedFolders.remove(folder.id)
                    } else {
                        expandedFolders.insert(folder.id)
                    }
                }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: isExpanded ? "folder.fill" : "folder")
                        .foregroundStyle(.secondary)
                    Text(folder.name)
                    Text("(\(folderChildren.count))")
                        .foregroundStyle(.tertiary)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                        .foregroundStyle(.tertiary)
                }
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private func nestedFolderRow(_ folder: Playlist) -> some View {
        let isExpanded = expandedFolders.contains(folder.id)
        let folderChildren = children(of: folder.id)

        Button {
            withAnimation {
                if isExpanded {
                    expandedFolders.remove(folder.id)
                } else {
                    expandedFolders.insert(folder.id)
                }
            }
        } label: {
            HStack(spacing: 16) {
                Image(systemName: isExpanded ? "folder.fill" : "folder")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                    .frame(width: 40)
                VStack(alignment: .leading) {
                    Text(folder.name)
                        .font(.body)
                    Text("\(folderChildren.count) playlists · \(folderTrackCount(folder.id)) tracks")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    .foregroundStyle(.tertiary)
            }
        }
        .buttonStyle(.plain)

        if isExpanded {
            ForEach(folderChildren) { child in
                playlistRow(child)
                    .padding(.leading, 40)
            }
        }
    }

    @ViewBuilder
    private func playlistRow(_ playlist: Playlist) -> some View {
        NavigationLink(value: playlist) {
            HStack(spacing: 16) {
                Image(systemName: playlist.isSmart ? "gear" : "music.note.list")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                    .frame(width: 40)
                VStack(alignment: .leading) {
                    Text(playlist.name)
                        .font(.body)
                    Text("\(playlist.trackCount) tracks")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
