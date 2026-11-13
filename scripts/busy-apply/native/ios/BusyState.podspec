Pod::Spec.new do |s|
  s.name           = 'BusyState'
  s.version        = '0.0.1'
  s.summary        = 'Module state check for the busy-apply harness'
  s.license        = 'Apache-2.0'
  s.author         = 'Shipvo'
  s.homepage       = 'https://shipvo.dev'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/shipvo/shipvo.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = '**/*.{h,m,swift}'
end
