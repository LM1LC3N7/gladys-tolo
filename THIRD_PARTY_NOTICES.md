# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`).

Its App Box protocol code (`src/tolo/protocol.js`, `src/tolo/client.js`, the
App Box limits of `src/constants.js`) and the fake App Box of the tests
(`test/fixtures/fakeTolo.js`) are a JavaScript port of parts of **tololib**
1.2.2 (<https://gitlab.com/MatthiasLohr/tololib>), the Python library of the
TOLO integration for Home Assistant: the frame layout (prefix, suffix, XOR
checksum), the command codes, the requests of `protocol.py`, the meaning of
the status and settings bytes (`state.py`), the bounds of `const.py` (UDP port
51500, setpoints 35 to 60 °C, timers up to 60 min), the keep-alive byte, the
retry on silence of `client.py` and the answers of `device_simulator.py`. No
Python code runs here and the library is not a dependency. It carries this
license (file `LICENSE.md` of the project):

```
MIT License

Copyright (c) 2021-2024 Matthias Lohr <mail@mlohr.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The runtime dependency `@gladysassistant/integration-sdk` (Apache-2.0) and
the base image `node:24-alpine` carry their own licenses.
