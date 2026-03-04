import Foundation
import Intents

class PlayMediaIntentHandler: NSObject, INPlayMediaIntentHandling {

    // MARK: - Resolve

    func resolvePlayShuffled(for intent: INPlayMediaIntent) async -> INBooleanResolutionResult {
        return .success(with: intent.playShuffled ?? false)
    }

    func resolvePlaybackRepeatMode(for intent: INPlayMediaIntent) async -> INPlaybackRepeatModeResolutionResult {
        return .success(with: intent.playbackRepeatMode)
    }

    func resolveMediaItems(for intent: INPlayMediaIntent) async -> [INPlayMediaMediaItemResolutionResult] {
        let search = intent.mediaSearch
        let mediaName = search?.mediaName ?? ""
        let artistName = search?.artistName ?? ""
        let albumName = search?.albumName ?? ""

        let tracks: [Track]
        do {
            if !artistName.isEmpty {
                // "Play songs by [artist]"
                tracks = try DatabaseManager.shared.searchTracksByArtist(artistName)
            } else if !albumName.isEmpty {
                // "Play [album]"
                tracks = try DatabaseManager.shared.searchTracksByAlbum(albumName)
            } else if !mediaName.isEmpty {
                // "Play [song name]" or general search
                switch search?.mediaType {
                case .artist:
                    tracks = try DatabaseManager.shared.searchTracksByArtist(mediaName)
                case .album:
                    tracks = try DatabaseManager.shared.searchTracksByAlbum(mediaName)
                default:
                    tracks = try DatabaseManager.shared.searchTracks(query: mediaName)
                }
            } else {
                // "Play a random song", "shuffle my music", "play something"
                let mediaItem = INMediaItem(
                    identifier: "shuffleAll",
                    title: "Shuffled Music",
                    type: .music,
                    artwork: nil
                )
                return [.success(with: mediaItem)]
            }
        } catch {
            return [.unsupported()]
        }

        guard !tracks.isEmpty else {
            return [.unsupported()]
        }

        let ids = tracks.map { String($0.id) }.joined(separator: ",")
        let firstTrack = tracks[0]
        let mediaItem = INMediaItem(
            identifier: ids,
            title: firstTrack.title,
            type: .song,
            artwork: nil,
            artist: firstTrack.artist
        )
        return [.success(with: mediaItem)]
    }

    // MARK: - Handle

    func handle(intent: INPlayMediaIntent) async -> INPlayMediaIntentResponse {
        guard let identifier = intent.mediaItems?.first?.identifier else {
            return INPlayMediaIntentResponse(code: .failure, userActivity: nil)
        }

        // "Shuffle all" — same behavior as dice button
        if identifier == "shuffleAll" {
            do {
                let allTracks = try DatabaseManager.shared.fetchAllTracks()
                guard !allTracks.isEmpty else {
                    return INPlayMediaIntentResponse(code: .failure, userActivity: nil)
                }

                await MainActor.run {
                    let player = AudioPlayer.shared
                    if !player.shuffle {
                        player.toggleShuffle()
                    }
                    let randomIndex = Int.random(in: 0..<allTracks.count)
                    player.play(tracks: allTracks, startIndex: randomIndex)
                }

                return INPlayMediaIntentResponse(code: .success, userActivity: nil)
            } catch {
                return INPlayMediaIntentResponse(code: .failure, userActivity: nil)
            }
        }

        let trackIds = identifier.split(separator: ",").compactMap { Int64($0) }
        guard !trackIds.isEmpty else {
            return INPlayMediaIntentResponse(code: .failure, userActivity: nil)
        }

        do {
            let allTracks = try DatabaseManager.shared.fetchTracksByIds(trackIds)
            guard !allTracks.isEmpty else {
                return INPlayMediaIntentResponse(code: .failure, userActivity: nil)
            }

            let shuffled = intent.playShuffled ?? false

            await MainActor.run {
                let player = AudioPlayer.shared
                if shuffled && !player.shuffle {
                    player.toggleShuffle()
                }
                player.play(tracks: allTracks, startIndex: 0)
            }

            return INPlayMediaIntentResponse(code: .success, userActivity: nil)
        } catch {
            return INPlayMediaIntentResponse(code: .failure, userActivity: nil)
        }
    }
}
