import CarPlay

class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?
    private var browser: CarPlayBrowser?
    private var nowPlayingObserver: CarPlayNowPlayingObserver?

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        let browser = CarPlayBrowser(interfaceController: interfaceController)
        self.browser = browser

        // Set root template with empty placeholder tabs — CarPlay renders immediately
        let loadingPlaylists = CPListTemplate(title: "Playlists", sections: [])
        loadingPlaylists.tabImage = UIImage(systemName: "music.note.list")
        let loadingArtists = CPListTemplate(title: "Artists", sections: [])
        loadingArtists.tabImage = UIImage(systemName: "music.mic")
        let loadingAlbums = CPListTemplate(title: "Albums", sections: [])
        loadingAlbums.tabImage = UIImage(systemName: "square.stack")

        let tabBar = CPTabBarTemplate(templates: [
            loadingPlaylists,
            loadingArtists,
            loadingAlbums,
        ])
        interfaceController.setRootTemplate(tabBar, animated: false, completion: nil)

        // Configure Now Playing template with Up Next and shuffle/repeat buttons
        let nowPlaying = CPNowPlayingTemplate.shared
        nowPlaying.isUpNextButtonEnabled = true
        nowPlaying.isAlbumArtistButtonEnabled = false

        // Add shuffle and repeat buttons
        let observer = CarPlayNowPlayingObserver(interfaceController: interfaceController)
        self.nowPlayingObserver = observer
        nowPlaying.add(observer)
        observer.updateButtons()

        // Load real data on background thread, update tabs when ready
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let playlistsTab = browser.playlistsTab()
            let artistsTab = browser.artistsTab()
            let albumsTab = browser.albumsTab()

            DispatchQueue.main.async {
                guard self != nil else { return }
                tabBar.updateTemplates([
                    playlistsTab,
                    artistsTab,
                    albumsTab,
                ])
            }
        }
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController
    ) {
        if let observer = nowPlayingObserver {
            CPNowPlayingTemplate.shared.remove(observer)
        }
        self.interfaceController = nil
        self.browser = nil
        self.nowPlayingObserver = nil
    }
}

// MARK: - Now Playing Observer (Up Next + Shuffle/Repeat)

class CarPlayNowPlayingObserver: NSObject, CPNowPlayingTemplateObserver {
    private let interfaceController: CPInterfaceController

    init(interfaceController: CPInterfaceController) {
        self.interfaceController = interfaceController
        super.init()
    }

    func nowPlayingTemplateUpNextButtonTapped(_ nowPlayingTemplate: CPNowPlayingTemplate) {
        // Show the up next queue
        let player = AudioPlayer.shared
        let upcoming = player.upcomingTracks
        if upcoming.isEmpty {
            let empty = CPListTemplate(title: "Up Next", sections: [
                CPListSection(items: [CPListItem(text: "Queue is empty", detailText: nil)])
            ])
            interfaceController.pushTemplate(empty, animated: true, completion: nil)
            return
        }

        let items = upcoming.prefix(50).enumerated().map { index, track in
            let item = CPListItem(
                text: track.title,
                detailText: track.displayArtist
            )
            item.handler = { _, completion in
                player.skipToQueueIndex(player.queueIndex + 1 + index)
                completion()
            }
            return item
        }

        let template = CPListTemplate(title: "Up Next", sections: [
            CPListSection(items: items)
        ])
        interfaceController.pushTemplate(template, animated: true, completion: nil)
    }

    func updateButtons() {
        let player = AudioPlayer.shared

        // Shuffle button
        let shuffleButton = CPNowPlayingShuffleButton { _ in
            player.toggleShuffle()
        }

        // Repeat button
        let repeatButton = CPNowPlayingRepeatButton { _ in
            player.cycleRepeat()
        }

        CPNowPlayingTemplate.shared.updateNowPlayingButtons([shuffleButton, repeatButton])

        // Sync initial state
        player.nowPlayingManager.updateShuffleRepeatState(shuffle: player.shuffle, repeatMode: player.repeatMode)
    }
}
