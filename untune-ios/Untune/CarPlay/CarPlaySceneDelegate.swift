import CarPlay

class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?
    private var browser: CarPlayBrowser?

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        let browser = CarPlayBrowser(interfaceController: interfaceController)
        self.browser = browser

        let tabBar = CPTabBarTemplate(templates: [
            browser.nowPlayingTab(),
            browser.playlistsTab(),
            browser.artistsTab(),
            browser.albumsTab(),
        ])
        interfaceController.setRootTemplate(tabBar, animated: true, completion: nil)
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController
    ) {
        self.interfaceController = nil
        self.browser = nil
    }
}
