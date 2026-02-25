export function WelcomeAnimation() {
  // Use system preference since theme store hasn't initialized yet
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  return (
    <div className="flex flex-col items-center justify-center">
      <img
        src={isDark ? "/icon-dark.png" : "/icon-light.png"}
        alt=""
        width={200}
        height={200}
      />
      <div
        className="w-7 h-7 mt-8 rounded-full animate-spin"
        style={{
          border: "2.5px solid",
          borderColor: isDark ? "#404040" : "#d4d4d4",
          borderTopColor: isDark ? "#a3a3a3" : "#525252",
        }}
      />
    </div>
  );
}
