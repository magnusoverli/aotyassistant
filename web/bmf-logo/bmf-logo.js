// <bmf-logo> - the animated Bjørgvin Mørkemusikk Forening logo as a drop-in web component.
//
//   <script type="module" src="bmf-logo.js"></script>
//   <bmf-logo style="width:480px;color:white" order="random" jitter="0.6" loop></bmf-logo>
//
// Every setting is an HTML attribute, so it can be changed at any time from the page
// (el.setAttribute("duration", 2) or el.configure({ duration: 2, loop: true })).
// Changing a setting restarts the animation. The logo takes the text colour of its parent.
//
// Settings (attribute: default)
//   order: random        which letters start first: random | center | edges | left | right
//   jitter: 0.5          0-1, how much random variation is mixed into start times and speeds
//   origin: random       where on each letter growth starts: random | base | top
//   sprouts: 2           how many points each letter grows from at once (1-4)
//   duration: 1.1        seconds one letter takes to grow
//   spread: 1.2          seconds between the first and the last letter starting
//   bloom-duration: 0.6  seconds the arrowheads take to pop in
//   loop                 present = replay forever (use as a loader)
//   hold: 1.6            loop only: seconds the finished logo stays visible
//   fade: 0.45           loop only: seconds of fade-out before the next round
//   seed                 a number = the same "random" growth every time; absent = different each time
//   paused               present = stay hidden until play() is called
//
// Methods: play(), finish() (jump to the finished logo), configure({...}).
// Event: "finish" fires each time the logo has fully grown.

const DATA = {"w":575.383,"h":267.643,"letters":[{"cx":183.13,"d":"M165.76 193.33L183.13 172.75L200.5 193.33L200.5 196.52L190.7 208.13L200.29 219.49L183.13 239.81L165.76 219.23ZM160.69 191.44L160.69 221.12L183.13 247.71L205.57 221.12L205.57 217.86L197.37 208.13L205.57 198.41L205.57 191.44L183.13 164.85L165.76 185.43Z","subs":[{"d":"M183.13 239.81L165.76 219.23L165.76 193.33L183.13 172.75L200.5 193.33L200.5 196.52L190.7 208.13L200.29 219.49Z","top":0.479},{"d":"M183.13 247.71L205.57 221.12L205.57 217.86L197.37 208.13L205.57 198.41L205.57 191.44L183.13 164.85L165.76 185.43L160.69 191.44L160.69 221.12Z","top":0.515}]},{"cx":363.54,"d":"M385.98 33.65L385.98 26.68L370.19 7.97L370.19 7.97L370.19 15.84L380.91 28.54L380.91 31.76L371.11 43.37L371.13 43.39L380.7 54.73L363.54 75.05L346.17 54.47L346.17 28.57L346.17 28.54L356.89 15.84L356.89 7.97L341.1 26.68L341.1 56.36L363.54 82.95L385.98 56.36L385.98 53.13L385.98 53.1L377.78 43.37Z","subs":[{"d":"M363.54 82.95L385.98 56.36L385.98 53.13L385.98 53.1L377.78 43.37L385.98 33.65L385.98 26.68L370.19 7.97L370.19 7.97L370.19 15.84L380.91 28.54L380.91 31.76L371.11 43.37L371.13 43.39L380.7 54.73L363.54 75.05L346.17 54.47L346.17 28.57L346.17 28.54L356.89 15.84L356.89 7.97L341.1 26.68L341.1 56.36Z","top":0.275}]},{"cx":314.36,"d":"M314.37 108.85L291.93 82.29L291.93 115.99L300.14 125.71L291.93 135.44L291.91 161.28L291.93 161.28L297 161.32L297 137.32L306.8 125.71L297 114.1L297 96.16L311.05 112.81L310.12 113.92L310.12 121.78L314.37 116.74L318.62 121.78L318.62 113.92L317.69 112.81L321.02 108.86L331.74 96.16L331.74 114.1L321.94 125.71L331.74 137.32L331.74 161.28L336.81 161.27L336.81 161.27L336.81 135.44L328.6 125.71L336.81 115.99L336.81 82.29Z","subs":[{"d":"M297 161.32L297 137.32L306.8 125.71L297 114.1L297 96.16L311.05 112.81L310.12 113.92L310.12 121.78L314.37 116.74L318.62 121.78L318.62 113.92L317.69 112.81L321.02 108.86L331.74 96.16L331.74 114.1L321.94 125.71L331.74 137.32L331.74 161.28L336.81 161.27L336.81 161.27L336.81 135.44L328.6 125.71L336.81 115.99L336.81 82.29L314.37 108.85L291.93 82.29L291.93 115.99L300.14 125.71L291.93 135.44L291.91 161.28L291.93 161.28Z","top":0.66}]},{"cx":62,"d":"M62.01 108.85L39.56 82.29L39.56 115.99L47.77 125.71L39.56 135.44L39.55 161.28L39.56 161.28L44.64 161.32L44.64 137.32L54.44 125.71L44.64 114.1L44.64 96.16L58.69 112.81L57.75 113.92L57.75 121.78L62.01 116.74L66.26 121.78L66.26 113.92L65.32 112.81L68.66 108.86L79.37 96.16L79.37 114.1L69.57 125.71L79.37 137.32L79.37 161.28L84.45 161.27L84.45 161.27L84.45 135.44L76.24 125.71L84.45 115.99L84.45 82.29Z","subs":[{"d":"M44.64 161.32L44.64 137.32L54.44 125.71L44.64 114.1L44.64 96.16L58.69 112.81L57.75 113.92L57.75 121.78L62.01 116.74L66.26 121.78L66.26 113.92L65.32 112.81L68.66 108.86L79.37 96.16L79.37 114.1L69.57 125.71L79.37 137.32L79.37 161.28L84.45 161.27L84.45 161.27L84.45 135.44L76.24 125.71L84.45 115.99L84.45 82.29L62.01 108.85L39.56 82.29L39.56 115.99L47.77 125.71L39.56 135.44L39.55 161.28L39.56 161.28Z","top":0.66}]},{"cx":263.47,"d":"M268.82 0L241.02 19.11L241.02 78.99L246.09 78.99L246.09 21.78L267.47 7.09L280.2 26.05L274.97 38.67L253.15 45.3L274.97 51.94L280.05 64.21L260.66 87.14L260.66 95.01L285.92 65.13L278.92 48.21L269.41 45.31L278.91 42.43L285.92 25.48L268.82 0Z","subs":[{"d":"M260.66 95.01L285.92 65.13L278.92 48.21L269.41 45.31L278.91 42.43L285.92 25.48L268.82 0L268.82 0L241.02 19.11L241.02 78.99L246.09 78.99L246.09 21.78L267.47 7.09L280.2 26.05L274.97 38.67L253.15 45.3L274.97 51.94L280.05 64.21L260.66 87.14Z","top":0.286}]},{"cx":235.13,"d":"M250.58 213.29L241.07 210.4L250.57 207.52L257.58 190.57L240.48 165.09L240.48 165.09L212.68 184.2L212.68 243.85L217.75 243.85L217.75 186.87L239.13 172.17L251.85 191.14L246.63 203.76L224.81 210.39L246.63 217.02L251.71 229.3L232.31 252.23L232.31 260.1L257.58 230.22Z","subs":[{"d":"M232.31 260.1L257.58 230.22L250.58 213.29L241.07 210.4L250.57 207.52L257.58 190.57L240.48 165.09L240.48 165.09L212.68 184.2L212.68 243.85L217.75 243.85L217.75 186.87L239.13 172.17L251.85 191.14L246.63 203.76L224.81 210.39L246.63 217.02L251.71 229.3L232.31 252.23Z","top":0.286}]},{"cx":166.8,"d":"M182.25 130.76L172.74 127.87L182.24 124.98L189.25 108.03L172.16 82.56L172.16 82.56L144.35 101.67L144.35 161.32L149.42 161.32L149.42 104.34L170.8 89.64L183.53 108.6L178.31 121.22L156.48 127.86L178.31 134.49L183.38 146.77L163.99 169.69L163.99 177.57L189.25 147.68Z","subs":[{"d":"M163.99 177.57L189.25 147.68L182.25 130.76L172.74 127.87L182.24 124.98L189.25 108.03L172.16 82.56L172.16 82.56L144.35 101.67L144.35 161.32L149.42 161.32L149.42 104.34L170.8 89.64L183.53 108.6L178.31 121.22L156.48 127.86L178.31 134.49L183.38 146.77L163.99 169.69Z","top":0.286}]},{"cx":260,"d":"M242.64 96.16L256.68 112.8L242.64 129.43ZM260.01 108.85L256.69 104.92L237.57 82.29L237.54 161.28L237.57 161.28L282.45 161.28L282.45 161.27L282.45 153.41L277.38 147.4L277.38 156.2L242.64 156.2L242.64 137.32L260.01 116.74L282.45 143.33L282.45 127.57L277.56 121.78L277.38 121.56L277.38 122L277.38 129.43L263.34 112.8L277.38 96.16L277.38 106.24L282.45 100.23L282.45 82.29Z","subs":[{"d":"M242.64 129.43L242.64 96.16L256.68 112.8Z","top":0.433},{"d":"M237.54 161.28L237.57 161.28L282.45 161.28L282.45 161.27L282.45 153.41L277.38 147.4L277.38 156.2L242.64 156.2L242.64 137.32L260.01 116.74L282.45 143.33L282.45 127.57L277.56 121.78L277.38 121.56L277.38 122L277.38 129.43L263.34 112.8L277.38 96.16L277.38 106.24L282.45 100.23L282.45 82.29L260.01 108.85L256.69 104.92L237.57 82.29Z","top":0.666}]},{"cx":287.18,"d":"M269.82 178.74L283.86 195.37L269.82 212ZM287.19 191.42L264.75 164.87L264.73 243.85L264.75 243.85L304.56 243.85L309.61 243.85L309.63 243.85L309.63 243.85L309.63 235.99L304.56 229.98L304.56 238.78L269.82 238.78L269.82 219.9L287.19 199.32L309.63 225.91L309.63 210.15L304.74 204.36L304.56 204.14L304.56 204.58L304.56 212L290.52 195.37L304.56 178.74L304.56 188.82L309.63 182.81L309.63 164.87Z","subs":[{"d":"M269.82 212L269.82 178.74L283.86 195.37Z","top":0.433},{"d":"M264.73 243.85L264.75 243.85L304.56 243.85L309.61 243.85L309.63 243.85L309.63 243.85L309.63 235.99L304.56 229.98L304.56 238.78L269.82 238.78L269.82 219.9L287.19 199.32L309.63 225.91L309.63 210.15L304.74 204.36L304.56 204.14L304.56 204.58L304.56 212L290.52 195.37L304.56 178.74L304.56 188.82L309.63 182.81L309.63 164.87L287.19 191.42L264.75 164.87Z","top":0.666}]},{"cx":336.24,"d":"M330.88 164.86L313.79 190.34L321.99 210.16L313.79 229.99L339.05 267.64L339.05 258.53L319.51 229.41L327.48 210.16L319.51 190.91L332.24 171.94L353.62 186.64L353.62 243.85L358.69 243.85L358.69 183.97L330.88 164.86Z","subs":[{"d":"M339.05 267.64L339.05 258.53L319.51 229.41L327.48 210.16L319.51 190.91L332.24 171.94L353.62 186.64L353.62 243.85L358.69 243.85L358.69 183.97L330.88 164.86L330.88 164.86L313.79 190.34L321.99 210.16L313.79 229.99Z","top":0.71}]},{"cx":400.36,"d":"M377.88 190.34L386.08 210.17L377.88 229.99L403.14 267.64L403.14 258.54L383.6 229.42L391.57 210.17L383.6 190.91L396.32 171.95L417.78 186.7L417.78 243.85L422.85 243.85L422.85 184.03L394.97 164.86Z","subs":[{"d":"M403.14 267.64L403.14 258.54L383.6 229.42L391.57 210.17L383.6 190.91L396.32 171.95L417.78 186.7L417.78 243.85L422.85 243.85L422.85 184.03L394.97 164.86L377.88 190.34L386.08 210.17L377.88 229.99Z","top":0.71}]},{"cx":126.92,"d":"M117.22 186.64L138.6 171.95L148.46 186.64L154.57 186.64L139.96 164.86L139.96 164.86L112.15 183.98L112.15 238.78L103.71 238.78L99.27 243.85L127.7 243.85L132.14 238.78L117.22 238.78L117.22 210.62L140.73 210.62L148.37 219.68L148.37 211.79L145.24 208.07L148.37 204.36L148.37 196.49L140.7 205.55L117.22 205.55Z","subs":[{"d":"M99.27 243.85L127.7 243.85L132.14 238.78L117.22 238.78L117.22 210.62L140.73 210.62L148.37 219.68L148.37 211.79L145.24 208.07L148.37 204.36L148.37 196.49L140.7 205.55L117.22 205.55L117.22 186.64L138.6 171.95L148.46 186.64L154.57 186.64L139.96 164.86L139.96 164.86L112.15 183.98L112.15 238.78L103.71 238.78Z","top":0.722}]},{"cx":374.18,"d":"M370.78 235.79L370.78 185.54L382.65 167.83L376.54 167.83L365.71 183.99L365.71 237.34L370.08 243.85L376.18 243.85Z","subs":[{"d":"M370.08 243.85L376.18 243.85L370.78 235.79L370.78 185.54L382.65 167.83L376.54 167.83L365.71 183.99L365.71 237.34Z","top":0.502}]},{"cx":400.63,"d":"M397.23 70.91L397.23 20.65L409.1 2.94L402.99 2.94L392.16 19.11L392.16 72.45L396.54 78.99L402.65 78.99Z","subs":[{"d":"M396.54 78.99L402.65 78.99L397.23 70.91L397.23 20.65L409.1 2.94L402.99 2.94L392.16 19.11L392.16 72.45Z","top":0.502}]},{"cx":483.94,"d":"M486.3 88.3L486.3 114.1L476.5 125.71L486.3 137.32L486.3 161.28L491.37 161.28L491.37 161.27L491.37 135.47L491.37 135.44L486.3 129.43L483.17 125.71L491.37 115.99L491.37 82.29Z","subs":[{"d":"M486.3 161.28L491.37 161.28L491.37 161.27L491.37 135.47L491.37 135.44L486.3 129.43L483.17 125.71L491.37 115.99L491.37 82.29L486.3 88.3L486.3 114.1L476.5 125.71L486.3 137.32Z","top":0.506}]},{"cx":114.38,"d":"M131.74 110.91L131.74 136.81L116.92 154.37L116.92 93.35ZM111.85 154.4L97.22 137.07L106.79 125.73L106.81 125.71L97.01 114.1L97.01 110.91L111.85 93.32ZM114.38 82.43L91.93 109.02L91.93 115.99L100.14 125.71L91.93 135.44L91.93 135.47L91.93 138.7L111.85 162.3L111.85 176.32L116.92 172.54L116.92 162.27L136.82 138.7L136.82 109.02Z","subs":[{"d":"M116.92 154.37L116.92 93.35L131.74 110.91L131.74 136.81Z","top":0.459},{"d":"M111.85 154.4L97.22 137.07L106.79 125.73L106.81 125.71L97.01 114.1L97.01 110.91L111.85 93.32Z","top":0.564},{"d":"M111.85 176.32L116.92 172.54L116.92 162.27L136.82 138.7L136.82 109.02L114.38 82.43L91.93 109.02L91.93 115.99L100.14 125.71L91.93 135.44L91.93 135.47L91.93 138.7L111.85 162.3Z","top":0.492}]},{"cx":211.09,"d":"M188.65 26.68L188.65 33.65L196.86 43.37L188.65 53.1L188.65 56.36L208.57 79.96L208.57 106.62L213.64 100.66L213.64 79.93L233.53 56.36L233.53 26.68L211.09 0.09ZM193.94 54.73L203.51 43.39L203.52 43.37L193.72 31.76L193.72 28.57L208.57 10.98L208.57 72.06ZM213.64 11.01L228.46 28.57L228.46 54.47L213.64 72.03Z","subs":[{"d":"M208.57 106.62L213.64 100.66L213.64 79.93L233.53 56.36L233.53 26.68L211.09 0.09L188.65 26.68L188.65 33.65L196.86 43.37L188.65 53.1L188.65 56.36L208.57 79.96Z","top":0.492},{"d":"M208.57 72.06L193.94 54.73L203.51 43.39L203.52 43.37L193.72 31.76L193.72 28.57L208.57 10.98Z","top":0.564},{"d":"M213.64 72.03L213.64 11.01L228.46 28.57L228.46 54.47Z","top":0.459}]},{"cx":443.86,"d":"M435.42 100.13L435.42 154.95L439.69 161.32L445.8 161.32L440.49 153.41L440.49 101.67L452.3 84.05L446.19 84.05Z","subs":[{"d":"M439.69 161.32L445.8 161.32L440.49 153.41L440.49 101.67L452.3 84.05L446.19 84.05L435.42 100.13L435.42 154.95Z","top":0.502}]},{"cx":460.07,"d":"M454.89 90.4L454.89 161.19L454.89 161.32L459.96 161.32L459.96 91.94L465.25 84.05L459.14 84.05Z","subs":[{"d":"M454.89 161.32L459.96 161.32L459.96 91.94L465.25 84.05L459.14 84.05L454.89 90.4L454.89 161.19Z","top":0.498}]},{"cx":528.31,"d":"M530.68 88.3L530.68 114.1L520.88 125.71L530.68 137.32L530.68 161.28L535.75 161.28L535.75 161.27L535.75 135.44L527.54 125.71L535.75 115.99L535.75 82.29Z","subs":[{"d":"M530.68 161.28L535.75 161.28L535.75 161.27L535.75 135.44L527.54 125.71L535.75 115.99L535.75 82.29L530.68 88.3L530.68 114.1L520.88 125.71L530.68 137.32Z","top":0.506}]},{"cx":504.45,"d":"M499.27 90.4L499.27 161.32L504.34 161.32L504.34 91.94L509.63 84.05L503.52 84.05Z","subs":[{"d":"M499.27 161.32L504.34 161.32L504.34 91.94L509.63 84.05L503.52 84.05L499.27 90.4Z","top":0.498}]},{"cx":364.4,"d":"M377.57 88.3L377.57 156.2L351.24 156.2L351.24 137.32L361.04 125.71L351.24 114.1L351.24 88.3L346.16 82.29L346.16 115.99L354.37 125.71L346.16 135.44L346.16 161.28L382.65 161.28L382.65 82.29Z","subs":[{"d":"M346.16 161.28L382.65 161.28L382.65 82.29L377.57 88.3L377.57 156.2L351.24 156.2L351.24 137.32L361.04 125.71L351.24 114.1L351.24 88.3L346.16 82.29L346.16 115.99L354.37 125.71L346.16 135.44Z","top":0.3}]},{"cx":198.03,"d":"M192.85 90.4L192.85 161.19L192.85 161.32L197.92 161.32L197.92 91.94L203.21 84.05L197.1 84.05Z","subs":[{"d":"M192.85 161.32L197.92 161.32L197.92 91.94L203.21 84.05L197.1 84.05L192.85 90.4L192.85 161.19Z","top":0.498}]},{"cx":221.9,"d":"M224.26 88.3L224.26 114.1L214.46 125.71L224.26 137.32L224.26 161.28L229.33 161.28L229.33 135.44L221.12 125.71L229.33 115.99L229.33 82.29Z","subs":[{"d":"M224.26 161.28L229.33 161.28L229.33 135.44L221.12 125.71L229.33 115.99L229.33 82.29L224.26 88.3L224.26 114.1L214.46 125.71L224.26 137.32Z","top":0.506}]},{"cx":431.69,"d":"M421.42 0.03L404.33 25.51L412.53 45.34L404.33 65.16L426.82 98.69L426.82 89.59L410.05 64.59L418.02 45.34L410.05 26.08L422.77 7.12L444.23 21.87L444.23 78.99L455.68 78.99L459.06 73.92L449.3 73.92L449.23 19.15L421.42 0.03Z","subs":[{"d":"M426.82 98.69L426.82 89.59L410.05 64.59L418.02 45.34L410.05 26.08L422.77 7.12L444.23 21.87L444.23 78.99L455.68 78.99L459.06 73.92L449.3 73.92L449.23 19.15L421.42 0.03L421.42 0.03L404.33 25.51L412.53 45.34L404.33 65.16Z","top":0.726}]},{"cx":408.48,"d":"M415.9 93.94L402.41 84.67L387.37 107L423.82 141.08L403.14 155.3L388.09 132.86L388.09 141.97L401.79 162.39L429.6 143.27L429.6 139.53L393.99 106.24L403.76 91.76L412.24 97.6L426.82 119.32L426.82 110.22Z","subs":[{"d":"M401.79 162.39L429.6 143.27L429.6 139.53L393.99 106.24L403.76 91.76L412.24 97.6L426.82 119.32L426.82 110.22L415.9 93.94L402.41 84.67L387.37 107L423.82 141.08L403.14 155.3L388.09 132.86L388.09 141.97Z","top":0.532}]},{"cx":172.4,"d":"M171.65 2.94L165.54 2.94L177.41 20.65L177.41 82.29L162.31 104.79L162.31 113.9L182.49 83.83L182.49 19.11Z","subs":[{"d":"M162.31 113.9L182.49 83.83L182.49 19.11L171.65 2.94L165.54 2.94L177.41 20.65L177.41 82.29L162.31 104.79Z","top":0.49}]},{"cx":142.92,"d":"M153.23 0L125.42 19.11L125.42 73.92L115.51 73.92L118.89 78.99L161.02 78.99L170.32 65.13L163.28 48.11L153.91 45.26L163.32 42.4L170.32 25.48ZM130.49 21.78L151.87 7.09L164.6 26.05L159.37 38.67L137.55 45.3L159.37 51.94L164.6 64.56L158.31 73.92L130.49 73.92Z","subs":[{"d":"M118.89 78.99L161.02 78.99L170.32 65.13L163.28 48.11L153.91 45.26L163.32 42.4L170.32 25.48L153.23 0L125.42 19.11L125.42 73.92L115.51 73.92Z","top":0.582},{"d":"M158.31 73.92L130.49 73.92L130.49 21.78L151.87 7.09L164.6 26.05L159.37 38.67L137.55 45.3L159.37 51.94L164.6 64.56Z","top":0.497}]},{"cx":311.16,"d":"M305.81 0L288.71 25.48L296.92 45.3L288.71 65.13L298.01 78.99L333.61 78.99L333.61 78.98L333.61 49.06L321.26 45.3L304.52 45.3L328.54 52.6L328.54 73.92L300.72 73.92L294.44 64.56L302.4 45.3L294.44 26.05L307.16 7.09L328.54 21.78L328.54 39.71L333.61 33.7L333.61 19.11Z","subs":[{"d":"M298.01 78.99L333.61 78.99L333.61 78.98L333.61 49.06L321.26 45.3L304.52 45.3L328.54 52.6L328.54 73.92L300.72 73.92L294.44 64.56L302.4 45.3L294.44 26.05L307.16 7.09L328.54 21.78L328.54 39.71L333.61 33.7L333.61 19.11L305.81 0L288.71 25.48L296.92 45.3L288.71 65.13Z","top":0.793}]},{"cx":457.16,"d":"M485.56 243.85L485.54 243.83L481.12 238.78L473.66 238.78L473.66 213.92L461.31 210.16L444.57 210.16L468.59 217.46L468.59 238.78L440.76 238.78L434.48 229.42L442.45 210.16L434.48 190.91L447.21 171.95L468.59 186.64L468.59 204.57L473.66 198.56L473.66 183.97L445.85 164.86L428.76 190.34L436.96 210.16L428.76 229.99L438.06 243.85Z","subs":[{"d":"M485.56 243.85L485.54 243.83L481.12 238.78L473.66 238.78L473.66 213.92L461.31 210.16L444.57 210.16L468.59 217.46L468.59 238.78L440.76 238.78L434.48 229.42L442.45 210.16L434.48 190.91L447.21 171.95L468.59 186.64L468.59 204.57L473.66 198.56L473.66 183.97L445.85 164.86L428.76 190.34L436.96 210.16L428.76 229.99L438.06 243.85Z","top":0.698}]}],"blooms":[{"d":"M545.43 121.03L549.54 125.73L545.43 130.43L548.21 133.61L575.38 125.73L548.21 117.85Z"},{"d":"M0 125.73L27.17 133.61L29.95 130.43L25.84 125.73L29.95 121.03L27.17 117.85Z"}]};
const SVG = "http://www.w3.org/2000/svg";
const DEFAULTS = { order: "random", jitter: 0.5, origin: "random", sprouts: 2, duration: 1.1, spread: 1.2,
                   "bloom-duration": 0.6, hold: 1.6, fade: 0.45 };
const ATTRS = [...Object.keys(DEFAULTS), "loop", "seed", "paused"];
let uid = 0;

// Small seeded random generator, so a given seed always gives the same growth.
const rng = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const el = (name, attrs, parent) => {
  const node = document.createElementNS(SVG, name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  parent.appendChild(node);
  return node;
};

class BmfLogo extends HTMLElement {
  static observedAttributes = ATTRS;
  #run = 0; #anims = []; #timer = 0; #queued = false; #all; #noise; #letters = []; #blooms = [];

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    const id = "bmf-grow-" + ++uid;
    // Constructed styles work with the app's style-src 'self' policy; no inline style tag.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`:host{display:block}svg{display:block;width:100%;height:auto;fill:currentColor}
      .grow{fill:none;stroke:#fff;stroke-width:5.8;stroke-linecap:round;stroke-linejoin:round}.solid{fill:#fff}
      .bloom{transform-box:fill-box;transform-origin:center}`);
    root.adoptedStyleSheets = [sheet];
    const svg = el("svg", { viewBox: `0 0 ${DATA.w} ${DATA.h}`, role: "img", "aria-label": "Bjørgvin Mørkemusikk Forening" }, root);
    const defs = el("defs", {}, svg);
    // Distort only the reveal ink, not the artwork: softly irregular tips still end in the exact logo.
    const filter = el("filter", { id: `${id}-organic`, filterUnits: "userSpaceOnUse",
      x: -8, y: -8, width: DATA.w + 16, height: DATA.h + 16, "color-interpolation-filters": "sRGB" }, defs);
    this.#noise = el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.13 0.19", numOctaves: 2, seed: 1, result: "noise" }, filter);
    el("feDisplacementMap", { in: "SourceGraphic", in2: "noise", scale: 2.2, xChannelSelector: "R", yChannelSelector: "G" }, filter);
    const mask = el("mask", { id, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: DATA.w, height: DATA.h }, svg);
    const growth = el("g", { filter: `url(#${id}-organic)` }, mask);
    this.#all = el("g", {}, svg);
    const masked = el("g", { mask: `url(#${id})` }, this.#all);
    // Each letter is revealed by its own outline, drawn as a growing line inside a mask.
    for (const letter of DATA.letters) {
      const strokes = letter.subs.map(s => ({ ...s, node: el("path", { class: "grow", pathLength: 1, d: s.d }, growth) }));
      const solid = el("path", { class: "solid", d: letter.d }, mask);
      el("path", { d: letter.d }, masked);
      this.#letters.push({ cx: letter.cx, strokes, solid });
    }
    for (const b of DATA.blooms) this.#blooms.push(el("path", { class: "bloom", d: b.d }, this.#all));
  }

  connectedCallback() { this.#restart(); }
  disconnectedCallback() { this.#stop(); }
  attributeChangedCallback() { if (this.isConnected) this.#restart(); }

  configure(settings) {
    for (const [k, v] of Object.entries(settings)) {
      if (v === false || v == null) this.removeAttribute(k);
      else this.setAttribute(k, v === true ? "" : v);
    }
  }
  play() { this.#stop(); this.#play(); }
  finish() { this.#stop(); }

  #num(name) { const v = parseFloat(this.getAttribute(name)); return Number.isFinite(v) ? v : DEFAULTS[name]; }
  #stop() {
    this.#run++;
    clearTimeout(this.#timer);
    this.#anims.forEach(a => a.cancel());
    this.#anims = [];
    this.#all.style.opacity = "";
  }
  // Several settings usually change together, so restart once after they have all been applied.
  #restart() {
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      this.#stop();
      if (this.hasAttribute("paused")) this.#all.style.opacity = 0;
      else if (this.isConnected) this.#play();
    });
  }

  #play() {
    const run = this.#run;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; // show the finished logo, no motion
    const seed = parseFloat(this.getAttribute("seed"));
    const rand = rng(Number.isFinite(seed) ? seed : (Math.random() * 2 ** 32) | 0);
    this.#noise.setAttribute("seed", 1 + Math.floor(rand() * 10000));
    const order = this.getAttribute("order") || DEFAULTS.order;
    const origin = this.getAttribute("origin") || DEFAULTS.origin;
    const jitter = Math.min(1, Math.max(0, this.#num("jitter")));
    const sprouts = Math.min(4, Math.max(1, Math.round(this.#num("sprouts"))));
    const duration = Math.max(0.05, this.#num("duration")), spread = Math.max(0, this.#num("spread"));
    const add = (node, frames, start, len, easing) =>
      this.#anims.push(node.animate(frames, { delay: start * 1000, duration: len * 1000, easing, fill: "both" }));

    let end = 0;
    for (const letter of this.#letters) {
      const side = letter.cx / DATA.w, mid = Math.abs(side - 0.5) * 2;
      const rank = order === "center" ? mid : order === "edges" ? 1 - mid : order === "left" ? side
                 : order === "right" ? 1 - side : rand();
      const start = (rank * (1 - jitter) + rand() * jitter) * spread;
      const len = duration * (1 + (rand() - 0.5) * 0.9 * jitter);
      end = Math.max(end, start + len);
      for (const s of letter.strokes) {
        // Rounded sprouts advance in unequal, smooth pulses. Every stage grows forward;
        // the fixed seed drives widths, pulse timing and the softly irregular reveal edge.
        const at = origin === "base" ? 0 : origin === "top" ? s.top : rand();
        const step = 1 / sprouts;
        const width = 5.8 * (1 + (rand() - 0.5) * .35 * jitter);
        const frames = [0, .15, .35, .6, .82, 1].map((offset, i, offsets) => {
          const amount = i === 0 ? 0 : i === offsets.length - 1 ? 1 : offset + (rand() - .5) * .16 * jitter;
          return { offset, strokeDasharray: `${step * amount} ${step * (1 - amount)}`,
            strokeDashoffset: step * amount / 2 - at, strokeWidth: i === 0 ? 0 : width,
            easing: "ease-in-out" };
        });
        add(s.node, frames, start, len, "linear");
      }
      // Fills in the few spots wider than the growing line (junctions, serifs) as the letter completes.
      add(letter.solid, [{ opacity: 0 }, { opacity: 1 }], start + len * 0.7, len * 0.3, "ease-in");
    }
    const bloom = Math.max(0.05, this.#num("bloom-duration"));
    this.#blooms.forEach((node, i) => {
      const start = Math.max(0, end - 0.45 + (rand() - 0.5) * 0.3 * jitter);
      add(node, [{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], start, bloom, "cubic-bezier(.3,1.5,.5,1)");
      if (i === this.#blooms.length - 1) end = Math.max(end, start + bloom);
    });

    Promise.all(this.#anims.map(a => a.finished)).then(() => {
      if (run !== this.#run) return;
      this.dispatchEvent(new Event("finish"));
      if (!this.hasAttribute("loop")) return;
      this.#timer = setTimeout(() => {
        const out = this.#all.animate([{ opacity: 1 }, { opacity: 0 }], { duration: this.#num("fade") * 1000, easing: "ease-in", fill: "forwards" });
        this.#anims.push(out);
        out.finished.then(() => { if (run === this.#run) { this.#stop(); this.#play(); } }, () => {});
      }, this.#num("hold") * 1000);
    }, () => {});
  }
}

if (!customElements.get("bmf-logo")) customElements.define("bmf-logo", BmfLogo);
export { BmfLogo };
