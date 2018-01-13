## Controlling Arcam AV receivers from Roon

This project provides a Roon Volume Control extension that allows you to control volume and mute from within Roon. It does so by connecting the receiver via its network interface.

## Installation

1. Install Node.js from https://nodejs.org.

   * On Windows, install from the above link.
   * On Mac OS, you can use [homebrew](http://brew.sh) to install Node.js.
   * On Linux, you can use your distribution's package manager, but make sure it installs a recent Node.js. Otherwise just install from the above link.

   The extension has been developed with Node v8.4.0. While it may work with older versions, it's not something that I've tested.

1. Install Git from https://git-scm.com/downloads.
   * Following the instructions for the Operating System you are running.

1. Download the Arcam AVR extension.

   * Go to the [roon-extension-arcam](https://github.com/docbobo/roon-extension-arcam) page on [GitHub](https://github.com).
   * Click the green 'Clone or Download' button and select 'Download ZIP'.

1. Extract the zip file in a local folder.

1. Change directory to the extension in the local folder:
    ```
    cd <local_folder>/roon-extension-arcam
    ```
    *Replace `<local_folder>` with the local folder path.*

1. Install the dependencies:
    ```bash
    npm install
    ```

1. Run it!
    ```bash
    node .
    ```

    The extension should appear in Roon now. See Settings->Setup->Extensions and you should see it in the list. Once it has been properly configured, it can be added as 'Volume Control' extension to an existing output zone.

## Notes

* Setups with more than one Roon Core on the network are not currently tested.
