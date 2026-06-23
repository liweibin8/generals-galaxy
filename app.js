/**
 * 将星河 · 古代人物三维星系可视化
 * Three.js WebGL 3D Galaxy of Chinese Historical Figures
 * v2 - 优化旋臂结构
 */

(function () {
    'use strict';

    // ========== 配置 ==========
    const CONFIG = {
        eraColors: {
            '上古':     new THREE.Color(0xFFFFFF),  // 纯白色（神话光芒）
            '先秦':     new THREE.Color(0xFFD700),  // 金色
            '秦汉':     new THREE.Color(0xFF6B35),  // 橙色
            '三国':     new THREE.Color(0xFF1744),  // 红色
            '魏晋南北朝': new THREE.Color(0xE040FB), // 紫色
            '隋唐五代': new THREE.Color(0x448AFF),  // 蓝色
            '宋元明清': new THREE.Color(0x69F0AE),  // 绿色
            '民国':     new THREE.Color(0xFF69B4),  // 粉色
            '近现代':   new THREE.Color(0x00BCD4),  // 青色
        },
        galaxy: {
            maxRadius: 140,
            coreRadius: 15,
            spiralFactor: 0.35,     // 螺旋因子（越大旋臂越紧）
            armSpread: 4.0,         // 旋臂宽度
            verticalSpread: 5.0,    // 垂直散布
            coreDensity: 0.7,       // 核心区域密度
        },
        camera: {
            fov: 60,
            near: 0.1,
            far: 2000,
            initDistance: 220,
            minDistance: 30,
            maxDistance: 500,
            autoRotateSpeed: 0.12,
        },
        particle: {
            minSize: 0.6,
            maxSize: 5.0,
            backgroundStars: 4000,
        }
    };

    // ========== 状态 ==========
    let scene, camera, renderer, clock;
    let galaxyPoints, backgroundStars, coreGlow;
    let generalsData = [];
    let currentIndexMap = new Map();
    let mouse = new THREE.Vector2(-999, -999);
    let raycaster = new THREE.Raycaster();
    let hoveredIndex = -1;
    let highlightedIndex = -1;
    let selectedGeneral = null;
    let isAutoRotating = true;
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let spherical = new THREE.Spherical(CONFIG.camera.initDistance, Math.PI / 2.5, 0);
    let targetSpherical = new THREE.Spherical(CONFIG.camera.initDistance, Math.PI / 2.5, 0);
    let currentEra = 'all';
    let animationTime = 0;
    let cameraTarget = new THREE.Vector3(0, 0, 0);  // 相机注视点（可偏移）
    let targetCameraTarget = new THREE.Vector3(0, 0, 0);

    // ========== 初始化 ==========
    function init() {
        clock = new THREE.Clock();

        scene = new THREE.Scene();

        camera = new THREE.PerspectiveCamera(
            CONFIG.camera.fov,
            window.innerWidth / window.innerHeight,
            CONFIG.camera.near,
            CONFIG.camera.far
        );

        const canvas = document.getElementById('galaxy-canvas');
        renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            alpha: false,
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000005, 1);

        setupEvents();
        loadGeneralsData();
    }

    // ========== 加载数据 ==========
    function loadGeneralsData() {
        fetch('generals_all.json')
            .then(r => r.json())
            .then(data => {
                generalsData = data;
                data.forEach((g, i) => currentIndexMap.set(g.name, i));
                document.getElementById('stat-total').textContent = data.length;
                const eras = new Set(data.map(g => g.era));
                document.getElementById('stat-era').textContent = eras.size;
                const years = getYearRange(data);
                document.getElementById('stat-years').textContent = years;
                buildGalaxy();
                buildBackgroundStars();
                addNebula();
                hideLoader();
                animate();
            })
            .catch(err => {
                console.error('加载数据失败:', err);
                document.querySelector('.loader-status').textContent = '加载失败: ' + err.message;
            });
    }

    function getYearRange(data) {
        let min = Infinity, max = -Infinity;
        data.forEach(g => {
            if (g.birth_year && g.birth_year < min) min = g.birth_year;
            if (g.death_year && g.death_year > max) max = g.death_year;
        });
        return max - min;
    }

    // ========== 伪随机（可重复） ==========
    function seededRandom(seed) {
        let s = seed;
        return function () {
            s = (s * 9301 + 49297) % 233280;
            return s / 233280;
        };
    }

    // ========== 构建星系 ==========
    function buildGalaxy() {
        const count = generalsData.length;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const originalSizes = new Float32Array(count);

        // 年份范围
        let minYear = Infinity, maxYear = -Infinity;
        generalsData.forEach(g => {
            const y = g.birth_year || g.death_year || 500;
            if (y < minYear) minYear = y;
            if (y > maxYear) maxYear = y;
        });
        const yearRange = maxYear - minYear || 1;

        // 朝代排序
        const eraOrder = ['上古', '先秦', '秦汉', '三国', '魏晋南北朝', '隋唐五代', '宋元明清', '民国', '近现代'];
        const eraIdx = {};
        eraOrder.forEach((e, i) => eraIdx[e] = i);
        const totalEras = eraOrder.length;

        for (let i = 0; i < count; i++) {
            const g = generalsData[i];
            const era = g.era || '先秦';
            const arm = eraIdx[era] !== undefined ? eraIdx[era] : 0;
            const fame = g.fame || g.rank || 5;
            const birthYear = g.birth_year || g.death_year || 500;
            const t = (birthYear - minYear) / yearRange; // [0, 1] 时间归一化

            const rng = seededRandom(i * 7 + 42);

            // ===== 螺旋旋臂布局 =====
            // 基础角度 = 该朝代对应的旋臂起始角度
            const armBaseAngle = (arm / totalEras) * Math.PI * 2;

            // 距离核心的距离：时间越晚越远，但名人可以靠近核心
            const fameNorm = fame / 10;
            const radiusFromTime = CONFIG.galaxy.coreRadius + t * (CONFIG.galaxy.maxRadius - CONFIG.galaxy.coreRadius);
            // 名人微微向核心聚拢
            const famePull = fameNorm * 15;
            const baseRadius = Math.max(5, radiusFromTime - famePull);

            // 螺旋角度偏移：距离越远，螺旋旋转越多
            const spiralAngle = armBaseAngle + baseRadius * CONFIG.galaxy.spiralFactor;

            // 随机散布（越远离中心、越不出名越散）
            const scatterFactor = (1 - fameNorm * 0.7) * CONFIG.galaxy.armSpread;
            const rJitter = (rng() - 0.5) * scatterFactor * 2;
            const aJitter = (rng() - 0.5) * 0.5;

            const finalRadius = Math.max(3, baseRadius + rJitter);
            const finalAngle = spiralAngle + aJitter;

            // 坐标
            const x = Math.cos(finalAngle) * finalRadius;
            const z = Math.sin(finalAngle) * finalRadius;
            // Y轴：靠近核心更扁平，外围更立体
            const yScale = 0.3 + (finalRadius / CONFIG.galaxy.maxRadius) * 0.7;
            const y = (rng() - 0.5) * CONFIG.galaxy.verticalSpread * yScale * (1 - fameNorm * 0.3);

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            // ===== 颜色 =====
            // 文臣用暖色调，武将用冷色调
            const generalType = generalsData[i].general_type;
            let color;
            if (generalType === 'civil') {
                // 文臣：粉色/金色系
                color = new THREE.Color().setHSL(0.08 + rng() * 0.05, 0.8, 0.65);
            } else {
                // 武将：蓝白色系
                color = CONFIG.eraColors[era] || new THREE.Color(0xFFFFFF);
            }
            // 核心区域更亮，外围稍暗
            const distFactor = 0.4 + (1 - finalRadius / CONFIG.galaxy.maxRadius) * 0.6;
            const brightness = (0.3 + fameNorm * 0.7) * distFactor;
            colors[i * 3] = color.r * brightness;
            colors[i * 3 + 1] = color.g * brightness;
            colors[i * 3 + 2] = color.b * brightness;

            // ===== 大小 =====
            const size = CONFIG.particle.minSize + fameNorm * (CONFIG.particle.maxSize - CONFIG.particle.minSize);
            sizes[i] = size;
            originalSizes[i] = size;
        }

        // 几何体
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        // 自定义着色器
        const vertexShader = `
            attribute float size;
            varying vec3 vColor;
            void main() {
                vColor = color;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * (250.0 / -mvPosition.z);
                gl_PointSize = clamp(gl_PointSize, 0.5, 800.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `;
        const fragmentShader = `
            varying vec3 vColor;
            void main() {
                float d = length(gl_PointCoord - vec2(0.5));
                if (d > 0.5) discard;
                // 多层光晕：核心 + 内晕 + 外晕
                float core = smoothstep(0.12, 0.0, d) * 1.0;
                float inner = exp(-d * 8.0) * 0.7;
                float outer = exp(-d * 3.0) * 0.3;
                vec3 finalColor = vColor * (core + inner + outer);
                float alpha = (core + inner + outer);
                alpha = clamp(alpha, 0.0, 1.0);
                gl_FragColor = vec4(finalColor, alpha);
            }
        `;

        const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        galaxyPoints = new THREE.Points(geometry, material);
        scene.add(galaxyPoints);

        // 存储原始大小用于筛选恢复
        galaxyPoints.userData.originalSizes = originalSizes;
        galaxyPoints.userData.originalColors = new Float32Array(colors);
    }

    // ========== 星云效果 ==========
    function addNebula() {
        // 核心光晕
        const glowGeo = new THREE.SphereGeometry(1, 32, 32);
        const glowMat = new THREE.ShaderMaterial({
            uniforms: {
                glowColor: { value: new THREE.Color(0xFFAA33) },
                intensity: { value: 1.0 },
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 glowColor;
                uniform float intensity;
                varying vec3 vNormal;
                void main() {
                    float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
                    float glow = pow(rim, 2.5) * intensity;
                    gl_FragColor = vec4(glowColor * glow, glow * 0.5);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
        });
        coreGlow = new THREE.Mesh(glowGeo, glowMat);
        coreGlow.scale.set(25, 25, 25);
        scene.add(coreGlow);

        // 内层核心亮点
        const innerGeo = new THREE.SphereGeometry(1, 16, 16);
        const innerMat = new THREE.MeshBasicMaterial({
            color: 0xFFDD88,
            transparent: true,
            opacity: 0.15,
            blending: THREE.AdditiveBlending,
        });
        const inner = new THREE.Mesh(innerGeo, innerMat);
        inner.scale.set(10, 10, 10);
        scene.add(inner);

        // 平面光晕（从上往下看的光圈）
        const discGeo = new THREE.PlaneGeometry(80, 80);
        const discMat = new THREE.ShaderMaterial({
            uniforms: {},
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                void main() {
                    float d = distance(vUv, vec2(0.5));
                    float alpha = exp(-d * 4.0) * 0.08;
                    vec3 color = vec3(1.0, 0.85, 0.5);
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });
        const disc = new THREE.Mesh(discGeo, discMat);
        disc.rotation.x = -Math.PI / 2;
        scene.add(disc);
    }

    // ========== 背景星空 ==========
    function buildBackgroundStars() {
        const count = CONFIG.particle.backgroundStars;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = 300 + Math.random() * 800;
            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);

            const brightness = 0.2 + Math.random() * 0.8;
            // 微妙的色温变化
            const temp = Math.random();
            colors[i * 3] = (0.7 + temp * 0.3) * brightness;
            colors[i * 3 + 1] = (0.7 + (1 - temp) * 0.3) * brightness;
            colors[i * 3 + 2] = (0.85 + Math.random() * 0.15) * brightness;

            sizes[i] = 0.3 + Math.random() * 1.2;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const vertexShader = `
            attribute float size;
            varying vec3 vColor;
            void main() {
                vColor = color;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * (100.0 / -mvPosition.z);
                gl_PointSize = clamp(gl_PointSize, 0.3, 5.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `;
        const fragmentShader = `
            varying vec3 vColor;
            void main() {
                float d = length(gl_PointCoord - vec2(0.5));
                if (d > 0.5) discard;
                float glow = exp(-d * 5.0);
                gl_FragColor = vec4(vColor, glow * 0.8);
            }
        `;

        const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            vertexColors: true,
            transparent: true,
            depthWrite: false,
        });

        backgroundStars = new THREE.Points(geometry, material);
        scene.add(backgroundStars);
    }

    // ========== 事件处理 ==========
    function setupEvents() {
        const canvas = renderer.domElement;

        canvas.addEventListener('mousemove', (e) => {
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            updateTooltip(e.clientX, e.clientY);
        });

        canvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            isAutoRotating = false;
            dragStart.x = e.clientX;
            dragStart.y = e.clientY;
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - dragStart.x;
            const dy = e.clientY - dragStart.y;
            targetSpherical.theta -= dx * 0.005;
            targetSpherical.phi = Math.max(0.15, Math.min(Math.PI - 0.15,
                targetSpherical.phi - dy * 0.005));
            dragStart.x = e.clientX;
            dragStart.y = e.clientY;
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
            setTimeout(() => { if (!isDragging) isAutoRotating = true; }, 5000);
        });

        // ===== Anchor Under Mouse 缩放 =====
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();

            const zoomFactor = 1 + e.deltaY * 0.001;
            const newRadius = Math.max(
                CONFIG.camera.minDistance,
                Math.min(CONFIG.camera.maxDistance,
                    targetSpherical.radius * zoomFactor)
            );

            // Anchor Under Mouse 核心算法：
            // 1. 从鼠标位置发射射线
            // 2. 求射线与穿过 cameraTarget 的平面的交点 P
            // 3. 缩放后，调整 cameraTarget 使得 P 仍然在鼠标下方
            
            const ndcX = (e.clientX / window.innerWidth) * 2 - 1;
            const ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
            
            const tempRaycaster = new THREE.Raycaster();
            tempRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
            
            // 构造一个过 cameraTarget、法线为视线方向的平面
            const viewDir = new THREE.Vector3();
            camera.getWorldDirection(viewDir);
            const plane = new THREE.Plane();
            plane.setFromNormalAndCoplanarPoint(viewDir, cameraTarget);
            
            // 求交点
            const anchorPoint = new THREE.Vector3();
            const hit = tempRaycaster.ray.intersectPlane(plane, anchorPoint);
            
            if (hit) {
                // ratio = 新距离/旧距离
                const ratio = newRadius / targetSpherical.radius;
                
                // 公式：newTarget = anchorPoint + (target - anchorPoint) * ratio
                // 等价于：shift = (anchorPoint - target) * (1 - ratio)
                const shift = new THREE.Vector3()
                    .subVectors(anchorPoint, cameraTarget)
                    .multiplyScalar(1 - ratio);
                
                targetCameraTarget.add(shift);
                
                // 限制范围
                const maxOffset = 200;
                targetCameraTarget.x = Math.max(-maxOffset, Math.min(maxOffset, targetCameraTarget.x));
                targetCameraTarget.y = Math.max(-maxOffset, Math.min(maxOffset, targetCameraTarget.y));
                targetCameraTarget.z = Math.max(-maxOffset, Math.min(maxOffset, targetCameraTarget.z));
            }
            
            // 滚轮解除锁定状态
            if (highlightedIndex >= 0) {
                highlightedIndex = -1;
            }
            targetSpherical.radius = newRadius;
        }, { passive: false });

        // 触摸支持
        let touchStart = null;
        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                isAutoRotating = false;
            }
        });
        canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1 && touchStart) {
                const dx = e.touches[0].clientX - touchStart.x;
                const dy = e.touches[0].clientY - touchStart.y;
                targetSpherical.theta -= dx * 0.005;
                targetSpherical.phi = Math.max(0.15, Math.min(Math.PI - 0.15,
                    targetSpherical.phi - dy * 0.005));
                touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        });
        canvas.addEventListener('touchend', () => {
            touchStart = null;
            setTimeout(() => { isAutoRotating = true; }, 5000);
        });

        canvas.addEventListener('click', () => {
            if (hoveredIndex >= 0) {
                // 清除之前的高亮
                if (highlightedIndex >= 0 && highlightedIndex !== hoveredIndex) {
                    highlightedIndex = -1;
                }
                highlightedIndex = hoveredIndex;
                selectGeneral(hoveredIndex);
            }
        });

        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        setupSearch();
        setupEraFilter();
        setupRandomBtn();

        document.getElementById('detail-close').addEventListener('click', () => {
            document.getElementById('detail-panel').classList.add('hidden');
            selectedGeneral = null;
        });
    }

    // ========== 搜索 ==========
    function setupSearch() {
        const input = document.getElementById('search-input');
        const results = document.getElementById('search-results');

        input.addEventListener('input', () => {
            const query = input.value.trim().toLowerCase();
            if (query.length === 0) { results.classList.remove('show'); highlightedIndex = -1; return; }

            const matches = generalsData
                .map((g, i) => ({ ...g, _index: i }))
                .filter(g => g.name.toLowerCase().includes(query) ||
                    (g.dynasty && g.dynasty.includes(query)))
                .slice(0, 15);

            if (matches.length === 0) {
                results.innerHTML = '<div class="search-item"><span class="meta">未找到</span></div>';
            } else {
                results.innerHTML = matches.map(g => `
                    <div class="search-item" data-index="${g._index}">
                        <div class="name">${g.name}</div>
                        <div class="meta">${g.dynasty || ''} · ${Array.isArray(g.achievements) ? g.achievements[0]?.substring(0, 30) : (g.achievements || '').substring(0, 30)}</div>
                    </div>
                `).join('');
                if (matches.length > 0) {
                    highlightedIndex = matches[0]._index;
                }
                results.querySelectorAll('.search-item[data-index]').forEach(el => {
                    el.addEventListener('click', () => {
                        const idx = parseInt(el.dataset.index);
                        flyToGeneral(idx);
                        selectGeneral(idx);
                        highlightedIndex = idx;
                        results.classList.remove('show');
                        input.value = '';
                    });
                });
            }
            results.classList.add('show');
        });

        input.addEventListener('blur', () => {
            highlightedIndex = -1;
            setTimeout(() => results.classList.remove('show'), 200);
        });
    }

    // ========== 朝代筛选 ==========
    function setupEraFilter() {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentEra = btn.dataset.era;
                filterEra(currentEra);
            });
        });
    }

    // ========== 随机按钮 ==========
    function setupRandomBtn() {
        const btn = document.getElementById('random-btn');
        btn.addEventListener('click', () => {
            if (generalsData.length === 0) return;
            const idx = Math.floor(Math.random() * generalsData.length);
            flyToGeneral(idx);
            selectGeneral(idx);
            highlightedIndex = idx;
        });
    }

    function filterEra(era) {
        if (!galaxyPoints) return;
        const colors = galaxyPoints.geometry.attributes.color;
        const sizes = galaxyPoints.geometry.attributes.size;
        const origColors = galaxyPoints.userData.originalColors;
        const origSizes = galaxyPoints.userData.originalSizes;

        for (let i = 0; i < generalsData.length; i++) {
            const g = generalsData[i];
            const matches = era === 'all' || g.era === era;

            if (matches) {
                colors.array[i * 3] = origColors[i * 3];
                colors.array[i * 3 + 1] = origColors[i * 3 + 1];
                colors.array[i * 3 + 2] = origColors[i * 3 + 2];
                sizes.array[i] = origSizes[i];
            } else {
                colors.array[i * 3] = 0.02;
                colors.array[i * 3 + 1] = 0.02;
                colors.array[i * 3 + 2] = 0.04;
                sizes.array[i] = 0.2;
            }
        }
        colors.needsUpdate = true;
        sizes.needsUpdate = true;

        // Re-apply highlight if the highlighted star still matches the era
        if (highlightedIndex >= 0 && highlightedIndex < generalsData.length) {
            const hg = generalsData[highlightedIndex];
            const stillMatches = era === 'all' || hg.era === era;
            if (!stillMatches) {
                highlightedIndex = -1;
            }
        }
    }

    // ========== 飞向将军 ==========
    function flyToGeneral(index) {
        const pos = galaxyPoints.geometry.attributes.position;
        const x = pos.array[index * 3];
        const y = pos.array[index * 3 + 1];
        const z = pos.array[index * 3 + 2];

        const dist = Math.sqrt(x * x + y * y + z * z);
        targetSpherical.radius = Math.max(8, dist * 0.02);
        targetSpherical.theta = Math.atan2(z, x);
        const r = Math.sqrt(x * x + y * y + z * z);
        targetSpherical.phi = r > 0 ? Math.acos(Math.max(-1, Math.min(1, y / r))) : Math.PI / 2;
        
        // 注视点飞向该将军
        targetCameraTarget.set(x, y, z);
    }

    // ========== 选中将军 ==========
    function selectGeneral(index) {
        const g = generalsData[index];
        selectedGeneral = g;

        document.getElementById('detail-name').textContent = g.name;
        document.getElementById('detail-title').textContent = g.title || '';

        document.getElementById('detail-meta').innerHTML = `
            <div class="meta-item"><span class="label">朝代</span><span class="value">${g.dynasty || '未知'}</span></div>
            <div class="meta-item"><span class="label">生卒</span><span class="value">${g.birth_year || '?'}-${g.death_year || '?'}</span></div>
        `;

        // 生平与战绩（优先显示 biography，回退到 achievements）
        const bioDiv = document.getElementById('detail-biography');
        let bioText = g.biography || '';
        if (!bioText && g.achievements) {
            bioText = Array.isArray(g.achievements) ? g.achievements.join('；') : g.achievements;
        }
        if (bioText) {
            bioDiv.textContent = bioText;
            bioDiv.style.display = 'block';
        } else {
            bioDiv.style.display = 'none';
        }

        // 战役
        const battlesDiv = document.getElementById('detail-battles');
        const battlesList = Array.isArray(g.battles) ? g.battles :
            (typeof g.battles === 'string' ? g.battles.split(/[·、，,]/).filter(Boolean) : []);
        if (battlesList.length > 0) {
            battlesDiv.innerHTML = battlesList.map(b => `<span class="battle-tag">${b.trim()}</span>`).join('');
            battlesDiv.style.display = 'block';
        } else {
            battlesDiv.style.display = 'none';
        }

        // 史学评价
        const evalDiv = document.getElementById('detail-evaluation');
        if (g.evaluation) {
            evalDiv.textContent = g.evaluation;
            evalDiv.style.display = 'block';
        } else {
            evalDiv.style.display = 'none';
        }

        const quoteDiv = document.getElementById('detail-quote');
        if (g.quote) {
            quoteDiv.textContent = `"${g.quote}"`;
            quoteDiv.style.display = 'block';
        } else {
            quoteDiv.style.display = 'none';
        }

        const relDiv = document.getElementById('detail-relationships');
        if (g.relationships && g.relationships.length > 0) {
            let html = '<div class="rel-group"><span class="rel-label">人物关系：</span>';
            g.relationships.forEach(rel => {
                html += `<span class="rel-name">${rel}</span>`;
            });
            html += '</div>';
            relDiv.innerHTML = html;
            relDiv.style.display = 'block';
        } else {
            relDiv.style.display = 'none';
        }

        const fame = g.fame || g.rank || 5;
        document.getElementById('detail-stars').innerHTML =
            '⭐'.repeat(Math.min(fame, 10)) +
            ` <span style="font-size:0.8rem;color:rgba(255,255,255,0.4)">${fame}/10</span>`;

        document.getElementById('detail-panel').classList.remove('hidden');
    }

    // ========== 搜索高亮 ==========
    function highlightStar(index) {
        highlightedIndex = index;
        flyToGeneral(index);
        selectGeneral(index);
    }

    function clearHighlight() {
        highlightedIndex = -1;
    }

    // ========== 悬浮提示 ==========
    function updateTooltip(mx, my) {
        if (!galaxyPoints) return;
        raycaster.params.Points.threshold = 2;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(galaxyPoints);
        const tooltip = document.getElementById('tooltip');

        if (intersects.length > 0) {
            const idx = intersects[0].index;
            const g = generalsData[idx];
            if (idx !== hoveredIndex) {
                hoveredIndex = idx;
                tooltip.innerHTML = `
                    <div class="tt-name">${g.name}</div>
                    <div class="tt-dynasty">${g.dynasty || ''} · ${g.birth_year || '?'}-${g.death_year || '?'}</div>
                `;
                tooltip.classList.remove('hidden');
                document.body.style.cursor = 'pointer';
            }
            tooltip.style.left = (mx + 16) + 'px';
            tooltip.style.top = (my - 10) + 'px';
        } else {
            hoveredIndex = -1;
            tooltip.classList.add('hidden');
            document.body.style.cursor = 'default';
        }
    }

    // ========== 加载完成 ==========
    function hideLoader() {
        setTimeout(() => {
            document.getElementById('loader').classList.add('fade-out');
            setTimeout(() => { document.getElementById('loader').style.display = 'none'; }, 1500);
        }, 500);
    }

    // ========== 动画循环 ==========
    function animate() {
        requestAnimationFrame(animate);
        const delta = clock.getDelta();
        animationTime += delta;

        // 自动旋转
        if (isAutoRotating) {
            targetSpherical.theta += CONFIG.camera.autoRotateSpeed * delta;
        }

        // 平滑插值
        spherical.radius += (targetSpherical.radius - spherical.radius) * 0.04;
        spherical.theta += (targetSpherical.theta - spherical.theta) * 0.04;
        spherical.phi += (targetSpherical.phi - spherical.phi) * 0.04;
        
        // 平滑插值相机注视点
        cameraTarget.lerp(targetCameraTarget, 0.04);

        camera.position.setFromSpherical(spherical).add(cameraTarget);
        camera.lookAt(cameraTarget);

        // 背景星空缓慢旋转
        if (backgroundStars) {
            backgroundStars.rotation.y += 0.00008;
        }

        // 核心光晕脉动
        if (coreGlow) {
            const pulse = 1.0 + Math.sin(animationTime * 0.5) * 0.1;
            coreGlow.scale.set(25 * pulse, 25 * pulse, 25 * pulse);
        }

        // 星系微小浮动
        if (galaxyPoints) {
            galaxyPoints.rotation.y = Math.sin(animationTime * 0.03) * 0.005;
        }

        // 选中星星：视角拉近 + 相机环绕（不改变星星大小和颜色）
        if (galaxyPoints && highlightedIndex >= 0) {
            const positions = galaxyPoints.geometry.attributes.position;
            const sx = positions.array[highlightedIndex * 3];
            const sy = positions.array[highlightedIndex * 3 + 1];
            const sz = positions.array[highlightedIndex * 3 + 2];
            // 相机注视点移向这颗星
            targetCameraTarget.set(sx, sy, sz);
            // 视野拉近
            const starDist = Math.sqrt(sx * sx + sy * sy + sz * sz);
            targetSpherical.radius = Math.max(8, starDist * 0.02);
            isAutoRotating = true;
        }

        renderer.render(scene, camera);
    }

    // ========== 暴露给录制脚本 ==========
    window.__galaxy = {
        get targetSpherical() { return targetSpherical; },
        get spherical() { return spherical; },
        setAutoRotate(v) { isAutoRotating = v; },
        flyToGeneral: flyToGeneral,
        selectGeneral: selectGeneral,
        filterEra: filterEra,
        highlightStar: highlightStar,
        clearHighlight: clearHighlight,
    };

    // ========== 启动 ==========
    init();

})();
