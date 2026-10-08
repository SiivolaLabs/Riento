const { withPodfile } = require("expo/config-plugins");

const modularHeaderPods = [
  "pod 'GoogleUtilities', :modular_headers => true",
  "pod 'RecaptchaInterop', :modular_headers => true"
];

module.exports = function withIosGoogleSignInPods(config) {
  return withPodfile(config, (nextConfig) => {
    const contents = nextConfig.modResults.contents;
    const missingPods = modularHeaderPods.filter((pod) => !contents.includes(pod));

    if (missingPods.length === 0) {
      return nextConfig;
    }

    const expoModulesLine = /^(\s*)use_expo_modules!\s*$/m;

    if (!expoModulesLine.test(contents)) {
      throw new Error("Unable to configure modular headers: use_expo_modules! was not found in the iOS Podfile.");
    }

    nextConfig.modResults.contents = contents.replace(expoModulesLine, (_line, indentation) => {
      const pods = missingPods.map((pod) => `${indentation}${pod}`).join("\n");
      return `${pods}\n\n${indentation}use_expo_modules!`;
    });

    return nextConfig;
  });
};
