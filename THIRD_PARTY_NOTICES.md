# Third-party notices

Doc Diff itself is MIT-licensed (see [LICENSE](LICENSE)). To run 100% offline as a single self-contained HTML file with zero external network or CDN requests, `DocDiff.html` (`site/index.html`) embeds the open-source libraries and fonts listed below.

| Component | Use in Doc Diff | License |
|---|---|---|
| [Geist & Geist Mono](https://vercel.com/font) (`vendor/fonts/`) | UI and monospace typography | SIL Open Font License 1.1, Copyright (c) Vercel, Inc. (also shipped in `vendor/fonts/OFL.txt`) |
| [Mozilla PDF.js](https://github.com/mozilla/pdf.js) 3.11.174 (`pdf.min.js`, `pdf.worker.min.js`) | Client-side PDF text extraction | Apache License 2.0, Copyright (c) Mozilla Foundation and Contributors |
| [Mammoth.js](https://github.com/mwilliamson/mammoth.js) 1.6.0 (`mammoth.browser.min.js`) | Client-side Word (`.docx`) text extraction | BSD 2-Clause License, Copyright (c) 2013 Michael Williamson |
| [jsdiff](https://github.com/kpdecker/jsdiff) 5.2.0 (`diff.min.js`) | Word-level inline diff computation | BSD 3-Clause License, Copyright (c) 2009-2015 Kevin Decker |

---

## Geist & Geist Mono (SIL Open Font License 1.1)

Copyright (c) Vercel, Inc. (`https://vercel.com/font`).
Licensed under the SIL Open Font License, Version 1.1. The full text of the license is included in [`vendor/fonts/OFL.txt`](vendor/fonts/OFL.txt).

---

## Mozilla PDF.js (Apache License 2.0)

Copyright 2023 Mozilla Foundation

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at:

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.

---

## Mammoth.js (BSD 2-Clause License)

Copyright (c) 2013, Michael Williamson
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

---

## jsdiff (BSD 3-Clause License)

Software License Agreement (BSD License)
Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>
All rights reserved.

Redistribution and use of this software in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
* Neither the name of Kevin Decker nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
