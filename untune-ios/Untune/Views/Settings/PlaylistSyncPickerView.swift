import SwiftUI

struct PlaylistSyncPickerView: View {
    @Environment(SyncEngine.self) private var syncEngine
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var syncEngine = syncEngine

        NavigationStack {
            List {
                Section {
                    ForEach(syncEngine.availablePlaylists, id: \.id) { playlist in
                        let isSelected = syncEngine.selectedPlaylistIds.contains(playlist.id)
                        Button {
                            if isSelected {
                                syncEngine.selectedPlaylistIds.remove(playlist.id)
                            } else {
                                syncEngine.selectedPlaylistIds.insert(playlist.id)
                            }
                        } label: {
                            HStack {
                                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(isSelected ? Color.accentColor : .secondary)
                                    .imageScale(.large)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(playlist.name)
                                        .foregroundStyle(.primary)
                                    Text("\(playlist.trackCount) tracks")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                Spacer()

                                if playlist.isSmart {
                                    Image(systemName: "gearshape")
                                        .font(.caption)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }
                    }
                } header: {
                    HStack {
                        Text("Playlists")
                        Spacer()
                        Text("\(syncEngine.availablePlaylists.count) available")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } footer: {
                    let uniqueCount = syncEngine.uniqueTrackCount(for: syncEngine.selectedPlaylistIds)
                    if !syncEngine.selectedPlaylistIds.isEmpty {
                        Text("\(syncEngine.selectedPlaylistIds.count) playlists selected — \(uniqueCount) unique tracks")
                    }
                }
            }
            .navigationTitle("Select Playlists")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        syncEngine.cancelSelection()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Sync") {
                        dismiss()
                        Task { await syncEngine.startSync() }
                    }
                    .disabled(syncEngine.selectedPlaylistIds.isEmpty)
                    .bold()
                }
                ToolbarItem(placement: .bottomBar) {
                    HStack {
                        Button("Select All") {
                            for playlist in syncEngine.availablePlaylists {
                                syncEngine.selectedPlaylistIds.insert(playlist.id)
                            }
                        }
                        Spacer()
                        Button("Deselect All") {
                            syncEngine.selectedPlaylistIds.removeAll()
                        }
                    }
                }
            }
        }
    }
}
