// set up global javascript variables

var bgUrl = 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=1427&q=80'

var blackholeMass = 1500;
var curblackholeMass = 0;

var canvas, gl, program; // canvas and webgl context

var shaderScript;
var shaderSource;
var vertexShader; // Not much happens in that shader, it just creates the vertices to be drawn on
var fragmentShader; // The fragment shader contains the effect.
var buffer;

/* Variables holding the location of uniform variables in WebGL. */
var locationOfTime;
var locationOfResolution;
var locationOfMouse;
var locationOfMass;
var locationOfclickedTime;

var originY = window.innerHeight,
    originX = window.innerWidth;

var mouse;

var startTime = new Date().getTime();
var currentTime = 0;

// The original click/hold animation is disabled by keeping this uniform at zero.
var clickedTime = 0;

function init(image) {
    canvas = document.getElementById('glscreen');
    gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

    if (!gl) {
        document.body.innerHTML = '<p style="color:white;font-family:sans-serif;padding:2rem">WebGL wird von diesem Browser nicht unterstützt.</p>';
        return;
    }

    canvas.width = window.innerWidth >= window.innerHeight ? window.innerWidth : window.innerHeight;
    canvas.height = window.innerWidth >= window.innerHeight ? window.innerWidth : window.innerHeight;

    // The black hole follows its original autonomous path; pointer tracking is disabled.
    mouse = {x: originX / 2, y: -(originY / 2) + canvas.height, moved: false};

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
            -1.0,  1.0,
             1.0, -1.0,
             1.0,  1.0
        ]),
        gl.STATIC_DRAW
    );

    shaderScript = document.getElementById("2d-vertex-shader");
    shaderSource = shaderScript.text;
    vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, shaderSource);
    gl.compileShader(vertexShader);

    shaderScript = document.getElementById("2d-fragment-shader");
    shaderSource = shaderScript.text;
    fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, shaderSource);
    gl.compileShader(fragmentShader);

    program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    locationOfResolution = gl.getUniformLocation(program, "u_resolution");
    locationOfMouse = gl.getUniformLocation(program, "u_mouse");
    locationOfMass = gl.getUniformLocation(program, "u_mass");
    locationOfTime = gl.getUniformLocation(program, "u_time");
    locationOfclickedTime = gl.getUniformLocation(program, "u_clickedTime");

    gl.uniform2f(locationOfResolution, canvas.width, canvas.height);
    gl.uniform2f(locationOfMouse, mouse.x, mouse.y);
    gl.uniform1f(locationOfMass, curblackholeMass * 0.00001);
    gl.uniform1f(locationOfTime, currentTime);
    gl.uniform1f(locationOfclickedTime, clickedTime);

    var texCoordLocation = gl.getAttribLocation(program, "a_texCoord");
    var texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
            -1.0,  1.0,
             1.0, -1.0,
             1.0,  1.0
        ]),
        gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    render();
}

function render() {
    var now = new Date().getTime();
    currentTime = (now - startTime) / 1000;

    if (curblackholeMass < blackholeMass - 50) {
        curblackholeMass += (blackholeMass - curblackholeMass) * 0.03;
    }

    // Keep the original idle movement; the cursor never changes the position.
    if (mouse.moved === false) {
        mouse.y = (-(originY / 2) + Math.sin(currentTime * 0.7) * (originY * 0.25)) + canvas.height;
        mouse.x = (originX / 2) + Math.sin(currentTime * 0.6) * -(originX * 0.35);
    }

    gl.uniform1f(locationOfMass, curblackholeMass * 0.00001);
    gl.uniform2f(locationOfMouse, mouse.x, mouse.y);
    gl.uniform1f(locationOfTime, currentTime);
    gl.uniform1f(locationOfclickedTime, 0.0);

    window.requestAnimationFrame(render);

    var positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

window.addEventListener('load', function() {
    var image = new Image();
    image.crossOrigin = "Anonymous";
    image.src = bgUrl;
    image.onload = function() {
        init(image);
    };
    image.onerror = function() {
        document.body.innerHTML = '<p style="color:white;font-family:sans-serif;padding:2rem">Der Sternenhintergrund konnte nicht geladen werden.</p>';
    };
});

window.addEventListener('resize', function() {
    if (!canvas || !gl) return;

    originY = window.innerHeight;
    originX = window.innerWidth;
    canvas.width = window.innerWidth >= window.innerHeight ? window.innerWidth : window.innerHeight;
    canvas.height = window.innerWidth >= window.innerHeight ? window.innerWidth : window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
    locationOfResolution = gl.getUniformLocation(program, "u_resolution");
    gl.uniform2f(locationOfResolution, canvas.width, canvas.height);
});